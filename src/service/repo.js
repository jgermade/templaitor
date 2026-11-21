// Data access for the hosted service. All SQL lives here (portable: `?` placeholders, TEXT ids,
// INTEGER ms timestamps) so another database adapter only has to provide get/all/run/exec/tx.
import { randomId } from './crypto.js'

export const ROLES = ['viewer', 'editor', 'admin', 'owner']
export const roleAtLeast = (role, min) => ROLES.indexOf(role) >= ROLES.indexOf(min)

const now = () => Date.now()
const json = (v, fallback) => { try { return JSON.parse(v) } catch { return fallback } }

export function createRepo(db) {
  const repo = {
    db,

    // ── Users ──
    userByEmail: (email) => db.get('SELECT * FROM users WHERE email = ?', normEmail(email)),
    userById: (id) => db.get('SELECT * FROM users WHERE id = ?', id),
    createUser(email, name = '') {
      const user = { id: randomId(), email: normEmail(email), name, created_at: now() }
      db.run('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)', user.id, user.email, user.name, user.created_at)
      return repo.userById(user.id)
    },
    updateUser: (id, { name }) => db.run('UPDATE users SET name = ? WHERE id = ?', name, id),
    touchLogin: (id) => db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), id),

    // ── Sessions ──
    createSession({ tokenHash, userId, ttlMs, userAgent = '', activeOrgId = null }) {
      const id = randomId()
      const t = now()
      db.run('INSERT INTO sessions (id, token_hash, user_id, active_org_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, tokenHash, userId, activeOrgId, t, t + ttlMs, t, String(userAgent).slice(0, 200))
      return id
    },
    sessionByTokenHash: (hash) => db.get('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', hash, now()),
    touchSession: (id, ttlMs) => db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now(), now() + ttlMs, id),
    setActiveOrg: (sessionId, orgId) => db.run('UPDATE sessions SET active_org_id = ? WHERE id = ?', orgId, sessionId),
    deleteSession: (id) => db.run('DELETE FROM sessions WHERE id = ?', id),
    deleteExpired() {
      const t = now()
      db.run('DELETE FROM sessions WHERE expires_at <= ?', t)
      db.run('DELETE FROM otp_codes WHERE expires_at <= ?', t - 24 * 3600e3)
      db.run('DELETE FROM challenges WHERE expires_at <= ?', t)
    },

    // ── One-time codes ──
    createOtp({ email, codeHash, ttlMs }) {
      const t = now()
      db.run('UPDATE otp_codes SET used_at = ? WHERE email = ? AND used_at IS NULL', t, normEmail(email))
      db.run('INSERT INTO otp_codes (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', randomId(), normEmail(email), codeHash, t, t + ttlMs)
    },
    countOtpsSince: (email, since) => db.get('SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?', normEmail(email), since).n,
    activeOtp: (email) => db.get('SELECT * FROM otp_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', normEmail(email), now()),
    otpAttempt: (id) => db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', id),
    useOtp: (id) => db.run('UPDATE otp_codes SET used_at = ? WHERE id = ?', now(), id),

    // ── WebAuthn challenges and passkeys ──
    createChallenge({ challenge, userId = null, kind, ttlMs = 5 * 60e3 }) {
      const id = randomId()
      db.run('INSERT INTO challenges (id, challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?, ?)', id, challenge, userId, kind, now() + ttlMs)
      return id
    },
    takeChallenge(id, kind) {
      const c = db.get('SELECT * FROM challenges WHERE id = ? AND kind = ? AND expires_at > ?', id, kind, now())
      db.run('DELETE FROM challenges WHERE id = ?', id)
      return c
    },
    passkeysOf: (userId) => db.all('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at', userId).map(parsePasskey),
    passkeyByCredentialId: (cid) => parsePasskey(db.get('SELECT * FROM passkeys WHERE credential_id = ?', cid)),
    addPasskey({ userId, credentialId, publicKey, counter, transports, name }) {
      db.run('INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        randomId(), userId, credentialId, publicKey, counter, JSON.stringify(transports || []), name || 'Passkey', now())
    },
    usePasskey: (id, counter) => db.run('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?', counter, now(), id),
    renamePasskey: (userId, id, name) => db.run('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?', name, id, userId),
    deletePasskey: (userId, id) => db.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', id, userId),

    // ── Organizations ──
    orgById: (id) => parseOrg(db.get('SELECT * FROM orgs WHERE id = ?', id)),
    orgBySlug: (slug) => parseOrg(db.get('SELECT * FROM orgs WHERE slug = ?', slug)),
    allOrgs: () => db.all('SELECT * FROM orgs ORDER BY name').map(parseOrg),
    createOrg({ name, slug, ownerId }) {
      const id = randomId()
      db.tx(() => {
        db.run('INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)', id, slug, name, now())
        if (ownerId) db.run('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', id, ownerId, 'owner', now())
      })
      return repo.orgById(id)
    },
    renameOrg: (id, name) => db.run('UPDATE orgs SET name = ? WHERE id = ?', name, id),
    setOrgSmtp: (id, smtp) => db.run('UPDATE orgs SET smtp = ? WHERE id = ?', JSON.stringify(smtp || {}), id),
    deleteOrg: (id) => db.run('DELETE FROM orgs WHERE id = ?', id),
    orgsOfUser: (userId) => db.all(`SELECT o.*, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = ? ORDER BY o.name`, userId).map(parseOrg),

    // ── Memberships and invitations ──
    membership: (orgId, userId) => db.get('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?', orgId, userId),
    members: (orgId) => db.all(`SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? ORDER BY u.email`, orgId),
    countOwners: (orgId) => db.get("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'", orgId).n,
    addMember: (orgId, userId, role) => db.run(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (org_id, user_id) DO NOTHING`, orgId, userId, role, now()),
    setRole: (orgId, userId, role) => db.run('UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?', role, orgId, userId),
    removeMember: (orgId, userId) => db.run('DELETE FROM memberships WHERE org_id = ? AND user_id = ?', orgId, userId),
    invite({ orgId, email, role, invitedBy }) {
      db.run(`INSERT INTO invitations (id, org_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (org_id, email) DO UPDATE SET role = excluded.role, accepted_at = NULL, created_at = excluded.created_at`,
      randomId(), orgId, normEmail(email), role, invitedBy, now())
      return db.get('SELECT * FROM invitations WHERE org_id = ? AND email = ?', orgId, normEmail(email))
    },
    invitations: (orgId) => db.all('SELECT * FROM invitations WHERE org_id = ? AND accepted_at IS NULL ORDER BY created_at', orgId),
    pendingInvitationsFor: (email) => db.all('SELECT * FROM invitations WHERE email = ? AND accepted_at IS NULL', normEmail(email)),
    deleteInvitation: (orgId, id) => db.run('DELETE FROM invitations WHERE id = ? AND org_id = ?', id, orgId),
    /** Turns the pending invitations of an email into memberships */
    acceptInvitations(user) {
      return db.tx(() => {
        const list = repo.pendingInvitationsFor(user.email)
        for (const inv of list) {
          repo.addMember(inv.org_id, user.id, inv.role)
          db.run('UPDATE invitations SET accepted_at = ? WHERE id = ?', now(), inv.id)
        }
        return list.length
      })
    },

    // ── API keys ──
    createApiKey({ orgId, name, prefix, keyHash, createdBy }) {
      const id = randomId()
      db.run('INSERT INTO api_keys (id, org_id, name, prefix, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, orgId, name, prefix, keyHash, createdBy, now())
      return db.get('SELECT id, org_id, name, prefix, created_at FROM api_keys WHERE id = ?', id)
    },
    apiKeys: (orgId) => db.all('SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE org_id = ? ORDER BY created_at DESC', orgId),
    apiKeyByPrefix: (prefix) => db.get('SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL', prefix),
    touchApiKey: (id) => db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), id),
    revokeApiKey: (orgId, id) => db.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL', now(), id, orgId),

    // ── Messages (send queue + log) ──
    enqueue(m) {
      const id = randomId()
      const t = now()
      db.run(`INSERT INTO messages (id, org_id, api_key_id, user_id, kind, template, locale, recipients, subject, payload, status,
        attempts, next_attempt_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
      id, m.orgId, m.apiKeyId ?? null, m.userId ?? null, m.kind, m.template ?? null, m.locale ?? null, JSON.stringify(m.recipients),
      m.subject || '', JSON.stringify(m.payload), t, m.idempotencyKey ?? null, t, t)
      return repo.message(m.orgId, id)
    },
    messageByIdempotencyKey: (orgId, key) => parseMessage(db.get('SELECT * FROM messages WHERE org_id = ? AND idempotency_key = ?', orgId, key)),
    message: (orgId, id) => parseMessage(db.get('SELECT * FROM messages WHERE org_id = ? AND id = ?', orgId, id)),
    messages: (orgId, { limit = 50, before = null, status = null } = {}) => db.all(`SELECT * FROM messages WHERE org_id = ?
      ${before ? 'AND created_at < ?' : ''} ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC LIMIT ?`,
    ...[orgId, before, status].filter(v => v != null), Math.min(Number(limit) || 50, 200)).map(parseMessage),
    countRecentSends: (orgId, since) => db.get('SELECT COUNT(*) AS n FROM messages WHERE org_id = ? AND created_at > ?', orgId, since).n,
    /** Claims the next due message (queued → sending) */
    claimNext() {
      return db.tx(() => {
        const m = db.get("SELECT * FROM messages WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1", now())
        if (!m) return null
        db.run("UPDATE messages SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?", now(), m.id)
        return parseMessage({ ...m, status: 'sending', attempts: m.attempts + 1 })
      })
    },
    markSent: (id, smtpMessageId) => db.run("UPDATE messages SET status = 'sent', smtp_message_id = ?, sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?",
      smtpMessageId, now(), now(), id),
    markRetry: (id, error, nextAt) => db.run("UPDATE messages SET status = 'queued', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?", error, nextAt, now(), id),
    markFailed: (id, error) => db.run("UPDATE messages SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", error, now(), id),
    /** Messages left in `sending` by a crash go back to the queue */
    requeueStuck: (olderThanMs) => db.run("UPDATE messages SET status = 'queued', updated_at = ? WHERE status = 'sending' AND updated_at < ?", now(), now() - olderThanMs),

    // ── Files (db storage driver) ──
    files: (orgId) => db.all('SELECT path, hash FROM files WHERE org_id = ?', orgId),
    fileContents: (orgId) => db.all('SELECT path, content FROM files WHERE org_id = ?', orgId),
    putFile: (orgId, path, content, hash) => db.run(`INSERT INTO files (org_id, path, content, hash, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (org_id, path) DO UPDATE SET content = excluded.content, hash = excluded.hash, updated_at = excluded.updated_at`,
    orgId, path, content, hash, now()),
    deleteFile: (orgId, path) => db.run('DELETE FROM files WHERE org_id = ? AND path = ?', orgId, path),
  }
  return repo
}

export const normEmail = (e) => String(e || '').trim().toLowerCase()

function parseOrg(o) {
  return o ? { ...o, smtp: json(o.smtp, {}) } : null
}
function parsePasskey(p) {
  return p ? { ...p, transports: json(p.transports, []) } : null
}
function parseMessage(m) {
  return m ? { ...m, recipients: json(m.recipients, {}), payload: json(m.payload, {}) } : null
}
