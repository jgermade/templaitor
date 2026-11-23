// Data access for the hosted service. All SQL lives here (portable: `?` placeholders, TEXT ids,
// timestamps in ms) so each database adapter only has to provide get/all/run/exec/tx (async).
import { randomId } from './crypto.js'

export const ROLES = ['viewer', 'editor', 'admin', 'owner']
export const roleAtLeast = (role, min) => ROLES.indexOf(role) >= ROLES.indexOf(min)

const now = () => Date.now()
const json = (v, fallback) => { try { return JSON.parse(v) } catch { return fallback } }
const count = (row) => Number(row?.n ?? 0)

export function createRepo(db) {
  const repo = {
    db,

    // ── Users ──
    userByEmail: (email) => db.get('SELECT * FROM users WHERE email = ?', normEmail(email)).then(numbers),
    userById: (id) => db.get('SELECT * FROM users WHERE id = ?', id).then(numbers),
    async createUser(email, name = '') {
      const id = randomId()
      await db.run('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)', id, normEmail(email), name, now())
      return repo.userById(id)
    },
    updateUser: (id, { name }) => db.run('UPDATE users SET name = ? WHERE id = ?', name, id),
    touchLogin: (id) => db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), id),

    // ── Sessions ──
    async createSession({ tokenHash, userId, ttlMs, userAgent = '', activeOrgId = null }) {
      const id = randomId()
      const t = now()
      await db.run('INSERT INTO sessions (id, token_hash, user_id, active_org_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, tokenHash, userId, activeOrgId, t, t + ttlMs, t, String(userAgent).slice(0, 200))
      return id
    },
    sessionByTokenHash: (hash) => db.get('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', hash, now()).then(numbers),
    touchSession: (id, ttlMs) => db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now(), now() + ttlMs, id),
    setActiveOrg: (sessionId, orgId) => db.run('UPDATE sessions SET active_org_id = ? WHERE id = ?', orgId, sessionId),
    deleteSession: (id) => db.run('DELETE FROM sessions WHERE id = ?', id),
    async deleteExpired() {
      const t = now()
      await db.run('DELETE FROM sessions WHERE expires_at <= ?', t)
      await db.run('DELETE FROM otp_codes WHERE expires_at <= ?', t - 24 * 3600e3)
      await db.run('DELETE FROM challenges WHERE expires_at <= ?', t)
    },

    // ── One-time codes ──
    async createOtp({ email, codeHash, ttlMs }) {
      const t = now()
      await db.tx(async () => {
        await db.run('UPDATE otp_codes SET used_at = ? WHERE email = ? AND used_at IS NULL', t, normEmail(email))
        await db.run('INSERT INTO otp_codes (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', randomId(), normEmail(email), codeHash, t, t + ttlMs)
      })
    },
    countOtpsSince: async (email, since) => count(await db.get('SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?', normEmail(email), since)),
    activeOtp: (email) => db.get('SELECT * FROM otp_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', normEmail(email), now()).then(numbers),
    otpAttempt: (id) => db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', id),
    useOtp: (id) => db.run('UPDATE otp_codes SET used_at = ? WHERE id = ?', now(), id),

    // ── WebAuthn challenges and passkeys ──
    async createChallenge({ challenge, userId = null, kind, ttlMs = 5 * 60e3 }) {
      const id = randomId()
      await db.run('INSERT INTO challenges (id, challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?, ?)', id, challenge, userId, kind, now() + ttlMs)
      return id
    },
    async takeChallenge(id, kind) {
      if (!id) return null
      return db.tx(async () => {
        const c = await db.get('SELECT * FROM challenges WHERE id = ? AND kind = ? AND expires_at > ?', id, kind, now())
        await db.run('DELETE FROM challenges WHERE id = ?', id)
        return c
      })
    },
    passkeysOf: async (userId) => (await db.all('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at', userId)).map(parsePasskey),
    passkeyByCredentialId: async (cid) => parsePasskey(await db.get('SELECT * FROM passkeys WHERE credential_id = ?', String(cid ?? ''))),
    addPasskey: ({ userId, credentialId, publicKey, counter, transports, name }) => db.run(
      'INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      randomId(), userId, credentialId, publicKey, counter, JSON.stringify(transports || []), name || 'Passkey', now()),
    usePasskey: (id, counter) => db.run('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?', counter, now(), id),
    renamePasskey: (userId, id, name) => db.run('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?', name, id, userId),
    deletePasskey: (userId, id) => db.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', id, userId),

    // ── Organizations ──
    orgById: async (id) => parseOrg(await db.get('SELECT * FROM orgs WHERE id = ?', id)),
    orgBySlug: async (slug) => parseOrg(await db.get('SELECT * FROM orgs WHERE slug = ?', slug)),
    async createOrg({ name, slug, ownerId }) {
      const id = randomId()
      await db.tx(async () => {
        await db.run('INSERT INTO orgs (id, slug, name, created_at) VALUES (?, ?, ?, ?)', id, slug, name, now())
        if (ownerId) await db.run('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', id, ownerId, 'owner', now())
      })
      return repo.orgById(id)
    },
    renameOrg: (id, name) => db.run('UPDATE orgs SET name = ? WHERE id = ?', name, id),
    setOrgSmtp: (id, smtp) => db.run('UPDATE orgs SET smtp = ? WHERE id = ?', JSON.stringify(smtp || {}), id),
    deleteOrg: (id) => db.run('DELETE FROM orgs WHERE id = ?', id),
    orgsOfUser: async (userId) => (await db.all(`SELECT o.*, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = ? ORDER BY o.name`, userId)).map(parseOrg),

    // ── Memberships and invitations ──
    membership: (orgId, userId) => db.get('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?', orgId, userId),
    members: async (orgId) => (await db.all(`SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? ORDER BY u.email`, orgId)).map(numbers),
    countOwners: async (orgId) => count(await db.get("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'", orgId)),
    addMember: (orgId, userId, role) => db.run(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (org_id, user_id) DO NOTHING`, orgId, userId, role, now()),
    setRole: (orgId, userId, role) => db.run('UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?', role, orgId, userId),
    removeMember: (orgId, userId) => db.run('DELETE FROM memberships WHERE org_id = ? AND user_id = ?', orgId, userId),
    async invite({ orgId, email, role, invitedBy }) {
      await db.run(`INSERT INTO invitations (id, org_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (org_id, email) DO UPDATE SET role = excluded.role, accepted_at = NULL, created_at = excluded.created_at`,
      randomId(), orgId, normEmail(email), role, invitedBy, now())
      return numbers(await db.get('SELECT * FROM invitations WHERE org_id = ? AND email = ?', orgId, normEmail(email)))
    },
    invitations: async (orgId) => (await db.all('SELECT * FROM invitations WHERE org_id = ? AND accepted_at IS NULL ORDER BY created_at', orgId)).map(numbers),
    pendingInvitationsFor: (email) => db.all('SELECT * FROM invitations WHERE email = ? AND accepted_at IS NULL', normEmail(email)),
    deleteInvitation: (orgId, id) => db.run('DELETE FROM invitations WHERE id = ? AND org_id = ?', id, orgId),
    /** Turns the pending invitations of an email into memberships */
    acceptInvitations(user) {
      return db.tx(async () => {
        const list = await repo.pendingInvitationsFor(user.email)
        for (const inv of list) {
          await repo.addMember(inv.org_id, user.id, inv.role)
          await db.run('UPDATE invitations SET accepted_at = ? WHERE id = ?', now(), inv.id)
        }
        return list.length
      })
    },

    // ── API keys ──
    async createApiKey({ orgId, name, prefix, keyHash, createdBy }) {
      const id = randomId()
      await db.run('INSERT INTO api_keys (id, org_id, name, prefix, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, orgId, name, prefix, keyHash, createdBy, now())
      return numbers(await db.get('SELECT id, org_id, name, prefix, created_at FROM api_keys WHERE id = ?', id))
    },
    apiKeys: async (orgId) => (await db.all('SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE org_id = ? ORDER BY created_at DESC', orgId)).map(numbers),
    apiKeyByPrefix: (prefix) => db.get('SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL', prefix).then(numbers),
    touchApiKey: (id) => db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), id),
    revokeApiKey: (orgId, id) => db.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL', now(), id, orgId),

    // ── Messages (send queue + log) ──
    async enqueue(m) {
      const id = randomId()
      const t = now()
      await db.run(`INSERT INTO messages (id, org_id, api_key_id, user_id, kind, template, template_version, locale, recipients, subject, payload, status,
        attempts, next_attempt_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
      id, m.orgId, m.apiKeyId ?? null, m.userId ?? null, m.kind, m.template ?? null, m.templateVersion ? JSON.stringify(m.templateVersion) : null,
      m.locale ?? null, JSON.stringify(m.recipients),
      m.subject || '', JSON.stringify(m.payload), t, m.idempotencyKey ?? null, t, t)
      return repo.message(m.orgId, id)
    },
    messageByIdempotencyKey: async (orgId, key) => parseMessage(await db.get('SELECT * FROM messages WHERE org_id = ? AND idempotency_key = ?', orgId, key)),
    message: async (orgId, id) => parseMessage(await db.get('SELECT * FROM messages WHERE org_id = ? AND id = ?', orgId, id)),
    async messages(orgId, { limit = 50, before = null, status = null } = {}) {
      const rows = await db.all(`SELECT * FROM messages WHERE org_id = ?${before ? ' AND created_at < ?' : ''}${status ? ' AND status = ?' : ''}
        ORDER BY created_at DESC LIMIT ?`, ...[orgId, before, status].filter(v => v != null), Math.min(Number(limit) || 50, 200))
      return rows.map(parseMessage)
    },
    countRecentSends: async (orgId, since) => count(await db.get('SELECT COUNT(*) AS n FROM messages WHERE org_id = ? AND created_at > ?', orgId, since)),
    /** Claims the next due message (queued → sending). Postgres: safe with several instances (SKIP LOCKED) */
    async claimNext() {
      if (db.driver === 'postgres') {
        const row = await db.get(`UPDATE messages SET status = 'sending', attempts = attempts + 1, updated_at = ?
          WHERE id = (SELECT id FROM messages WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING *`, now(), now())
        return parseMessage(row)
      }
      return db.tx(async () => {
        const m = await db.get("SELECT * FROM messages WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1", now())
        if (!m) return null
        await db.run("UPDATE messages SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?", now(), m.id)
        return parseMessage({ ...m, status: 'sending', attempts: Number(m.attempts) + 1 })
      })
    },
    markSent: (id, smtpMessageId) => db.run("UPDATE messages SET status = 'sent', smtp_message_id = ?, sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?",
      smtpMessageId, now(), now(), id),
    markRetry: (id, error, nextAt) => db.run("UPDATE messages SET status = 'queued', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?", error, nextAt, now(), id),
    markFailed: (id, error) => db.run("UPDATE messages SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", error, now(), id),
    /** Messages left in `sending` by a crash go back to the queue */
    requeueStuck: (olderThanMs) => db.run("UPDATE messages SET status = 'queued', updated_at = ? WHERE status = 'sending' AND updated_at < ?", now(), now() - olderThanMs),
    /** Retention: drops the content (HTML, text, attachments) of finished messages older than `before`; metadata stays */
    purgePayloads: async (before) => (await db.run(`UPDATE messages SET payload = '{"purged":true}', updated_at = ?
      WHERE status IN ('sent', 'failed') AND created_at < ? AND payload <> '{"purged":true}'`, now(), before)).changes,

    // ── Files (db storage driver) ──
    files: (orgId) => db.all('SELECT path, hash FROM files WHERE org_id = ?', orgId),
    /** Changes whenever a file of the org is added, changed or removed */
    filesStamp: async (orgId) => {
      const r = await db.get('SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM files WHERE org_id = ?', orgId)
      return `${Number(r?.n ?? 0)}:${Number(r?.m ?? 0)}`
    },
    fileContents: (orgId) => db.all('SELECT path, content FROM files WHERE org_id = ?', orgId),
    putFile: (orgId, path, content, hash) => db.run(`INSERT INTO files (org_id, path, content, hash, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (org_id, path) DO UPDATE SET content = excluded.content, hash = excluded.hash, updated_at = excluded.updated_at`,
    orgId, path, content, hash, now()),
    deleteFile: (orgId, path) => db.run('DELETE FROM files WHERE org_id = ? AND path = ?', orgId, path),

    // ── Template versions (db storage) ──
    versions: async (orgId, kind, docId, limit = 50) => (await db.all(`SELECT id, number, message, author_name, author_email, hash, created_at
      FROM versions WHERE org_id = ? AND kind = ? AND doc_id = ? ORDER BY number DESC LIMIT ?`, orgId, kind, docId, Math.min(Number(limit) || 50, 200))).map(numbers),
    versionByNumber: (orgId, kind, docId, number) => db.get('SELECT id FROM versions WHERE org_id = ? AND kind = ? AND doc_id = ? AND number = ?', orgId, kind, docId, number),
    version: async (orgId, kind, docId, id) => parseVersion(await db.get('SELECT * FROM versions WHERE org_id = ? AND kind = ? AND doc_id = ? AND id = ?', orgId, kind, docId, id)),
    /** Next number of the document, assigned inside the transaction (UNIQUE guards concurrent saves) */
    async createVersion({ orgId, kind, docId, message, authorName, authorEmail, files, hash }) {
      const id = randomId()
      await db.tx(async () => {
        const last = await db.get('SELECT MAX(number) AS n FROM versions WHERE org_id = ? AND kind = ? AND doc_id = ?', orgId, kind, docId)
        await db.run(`INSERT INTO versions (id, org_id, kind, doc_id, number, message, author_name, author_email, files, hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, orgId, kind, docId, Number(last?.n ?? 0) + 1, message, authorName || '', authorEmail || '',
        JSON.stringify(files), hash, now())
      })
      return repo.version(orgId, kind, docId, id)
    },
  }
  return repo
}

export const normEmail = (e) => String(e || '').trim().toLowerCase()

// timestamps and counters as numbers (Postgres BIGINT may come back as strings)
const NUMERIC = ['created_at', 'expires_at', 'last_seen_at', 'last_login_at', 'used_at', 'last_used_at', 'revoked_at', 'accepted_at',
  'attempts', 'counter', 'next_attempt_at', 'updated_at', 'sent_at']
function numbers(row) {
  if (!row) return row ?? null
  for (const k of NUMERIC) if (row[k] != null && typeof row[k] !== 'number') row[k] = Number(row[k])
  return row
}
function parseOrg(o) {
  return o ? { ...numbers(o), smtp: json(o.smtp, {}) } : null
}
function parsePasskey(p) {
  return p ? { ...numbers(p), transports: json(p.transports, []) } : null
}
function parseVersion(v) {
  return v ? { ...numbers(v), number: Number(v.number), files: json(v.files, {}) } : null
}
function parseMessage(m) {
  return m ? { ...numbers(m), recipients: json(m.recipients, {}), payload: json(m.payload, {}), template_version: json(m.template_version, null) } : null
}
