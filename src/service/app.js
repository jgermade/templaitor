// Hosted service: HTTP app (auth, organizations, org-scoped editor API, send API, editor SPA).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './db/index.js'
import { createRepo, ROLES, roleAtLeast, normEmail } from './repo.js'
import { createAuth } from './auth.js'
import { createMailer } from './mailer.js'
import { createStorage } from './storage.js'
import { createWorkspaces } from './workspaces.js'
import { createSender, messageView } from './sender.js'
import { encrypt, hashToken, randomToken } from './crypto.js'
import { httpError, readJson, sendJson } from './http.js'
import { listTemplates } from '../engine/project.js'
import { setPdfSandbox } from '../engine/pdf.js'

const EDITOR_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/editor')
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
}
// editor API calls a viewer may make (read and render only)
const VIEWER_POSTS = new Set(['/api/preview', '/api/pdf', '/api/pdf/validate', '/api/attachment'])

export async function createApp(config, { transportFactory, mailTransportFactory, log = console.log, editorDist = EDITOR_DIST } = {}) {
  setPdfSandbox(true)
  const db = await openDatabase(config.database)
  const repo = createRepo(db)
  const mailer = createMailer(config, { transportFactory: mailTransportFactory, log })
  const auth = createAuth({ config, repo, mailer })
  const storage = createStorage({ config, repo })
  const workspaces = createWorkspaces({ config, repo, storage })
  const sender = createSender({ config, repo, workspaces, transportFactory, log })
  const origin = new URL(config.baseUrl).origin

  // ── helpers ──
  const requireUser = (ctx) => {
    if (!ctx.auth) throw httpError(401, 'Sign in first')
    return ctx.auth.user
  }
  const orgFor = async (ctx, id, minRole = 'viewer') => {
    const user = requireUser(ctx)
    const org = await repo.orgById(id)
    const m = org && await repo.membership(org.id, user.id)
    if (!m) throw httpError(404, 'Organization not found')
    if (!roleAtLeast(m.role, minRole)) throw httpError(403, `This action needs the ${minRole} role`)
    return { org, role: m.role, user }
  }
  const orgView = (org, role) => ({
    id: org.id, slug: org.slug, name: org.name, role,
    storage: storage.driver, mapped: storage.isMapped(org),
  })
  const smtpView = (org) => {
    const s = org.smtp || {}
    return { host: s.host || '', port: s.port || 587, secure: !!s.secure, user: s.user || '', from: s.from || '', hasPassword: !!s.passEnc }
  }

  async function apiKeyOrg(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(tpl_([A-Za-z0-9]{8})_[A-Za-z0-9_-]+)$/)
    if (!m) throw httpError(401, 'Missing API key (Authorization: Bearer tpl_…)')
    const key = await repo.apiKeyByPrefix(m[2])
    if (!key || key.key_hash !== hashToken(config.secret, m[1])) throw httpError(401, 'Invalid API key')
    if (!key.last_used_at || Date.now() - key.last_used_at > 60e3) await repo.touchApiKey(key.id)
    return { org: await repo.orgById(key.org_id), key }
  }

  // ── JSON routes ──
  const routes = [
    ['GET', '/healthz', () => ({ ok: true })],

    // session and account
    ['GET', '/auth/session', async (ctx) => {
      if (!ctx.auth) return { mode: 'service', user: null, signup: config.signup, appName: config.appName }
      const { user, session } = ctx.auth
      const orgs = await repo.orgsOfUser(user.id)
      const active = orgs.find(o => o.id === session.active_org_id) ?? orgs[0] ?? null
      return {
        mode: 'service',
        appName: config.appName,
        user: { id: user.id, email: user.email, name: user.name, passkeys: (await repo.passkeysOf(user.id)).length },
        orgs: orgs.map(o => orgView(o, o.role)),
        activeOrg: active ? orgView(active, active.role) : null,
      }
    }],
    ['POST', '/auth/code', async (ctx) => auth.requestCode(ctx.req, ctx.body)],
    ['POST', '/auth/code/verify', async (ctx) => auth.verifyCode(ctx.req, ctx.res, ctx.body)],
    ['POST', '/auth/logout', async (ctx) => auth.logout(ctx.req, ctx.res)],
    ['POST', '/auth/passkeys/login/options', async (ctx) => auth.passkeyLoginOptions(ctx.req, ctx.res)],
    ['POST', '/auth/passkeys/login', async (ctx) => auth.passkeyLoginVerify(ctx.req, ctx.res, ctx.body)],
    ['GET', '/auth/passkeys', async (ctx) => auth.passkeys(requireUser(ctx))],
    ['POST', '/auth/passkeys/register/options', async (ctx) => auth.passkeyRegisterOptions(requireUser(ctx))],
    ['POST', '/auth/passkeys/register', async (ctx) => auth.passkeyRegisterVerify(requireUser(ctx), ctx.body)],
    ['PATCH', '/auth/passkeys/:id', async (ctx) => { await repo.renamePasskey(requireUser(ctx).id, ctx.params.id, String(ctx.body.name || '').slice(0, 60)); return { ok: true } }],
    ['DELETE', '/auth/passkeys/:id', async (ctx) => { await repo.deletePasskey(requireUser(ctx).id, ctx.params.id); return { ok: true } }],
    ['PATCH', '/auth/me', async (ctx) => { await repo.updateUser(requireUser(ctx).id, { name: String(ctx.body.name || '').trim().slice(0, 80) }); return { ok: true } }],

    // organizations
    ['GET', '/orgs', async (ctx) => (await repo.orgsOfUser(requireUser(ctx).id)).map(o => orgView(o, o.role))],
    ['POST', '/orgs', async (ctx) => {
      const user = requireUser(ctx)
      const name = String(ctx.body.name || '').trim().slice(0, 80)
      if (!name) throw httpError(400, 'The organization needs a name')
      const slug = await uniqueSlug(repo, ctx.body.slug || name)
      const org = await repo.createOrg({ name, slug, ownerId: user.id })
      try {
        await storage.scaffold(org, { starter: ctx.body.starter === 'demo' ? 'demo' : 'blank' })
      } catch (e) {
        await repo.deleteOrg(org.id)
        throw httpError(500, `Could not create the project: ${e.message}`)
      }
      await repo.setActiveOrg(ctx.auth.session.id, org.id)
      return orgView(org, 'owner')
    }],
    ['POST', '/orgs/:id/activate', async (ctx) => {
      const { org, role } = await orgFor(ctx, ctx.params.id)
      await repo.setActiveOrg(ctx.auth.session.id, org.id)
      return orgView(org, role)
    }],
    ['GET', '/orgs/:id', async (ctx) => {
      const { org, role } = await orgFor(ctx, ctx.params.id)
      return { ...orgView(org, role), smtp: roleAtLeast(role, 'admin') ? smtpView(org) : undefined }
    }],
    ['PATCH', '/orgs/:id', async (ctx) => {
      const { org } = await orgFor(ctx, ctx.params.id, 'admin')
      const name = String(ctx.body.name || '').trim().slice(0, 80)
      if (!name) throw httpError(400, 'The organization needs a name')
      await repo.renameOrg(org.id, name)
      return { ok: true }
    }],
    ['DELETE', '/orgs/:id', async (ctx) => {
      const { org } = await orgFor(ctx, ctx.params.id, 'owner')
      if (ctx.body.confirm !== org.slug) throw httpError(400, `Confirm with the organization slug (${org.slug})`)
      await repo.deleteOrg(org.id)
      storage.remove(org)
      workspaces.invalidate(org.id)
      return { ok: true }
    }],

    // members and invitations
    ['GET', '/orgs/:id/members', async (ctx) => {
      const { org, role } = await orgFor(ctx, ctx.params.id)
      return { members: await repo.members(org.id), invitations: roleAtLeast(role, 'admin') ? await repo.invitations(org.id) : [] }
    }],
    ['POST', '/orgs/:id/invitations', async (ctx) => {
      const { org, role, user } = await orgFor(ctx, ctx.params.id, 'admin')
      const email = normEmail(ctx.body.email)
      const newRole = checkRole(ctx.body.role || 'editor', role)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Enter a valid email address')
      const existing = await repo.userByEmail(email)
      if (existing && await repo.membership(org.id, existing.id)) throw httpError(409, `${email} is already a member`)
      const inv = await repo.invite({ orgId: org.id, email, role: newRole, invitedBy: user.id })
      await mailer.sendInvitation(email, { orgName: org.name, inviter: user.name || user.email }).catch(e => log?.(`invitation email: ${e.message}`))
      return inv
    }],
    ['DELETE', '/orgs/:id/invitations/:iid', async (ctx) => {
      const { org } = await orgFor(ctx, ctx.params.id, 'admin')
      await repo.deleteInvitation(org.id, ctx.params.iid)
      return { ok: true }
    }],
    ['PATCH', '/orgs/:id/members/:uid', async (ctx) => {
      const { org, role } = await orgFor(ctx, ctx.params.id, 'admin')
      const target = await repo.membership(org.id, ctx.params.uid)
      if (!target) throw httpError(404, 'Member not found')
      const newRole = checkRole(ctx.body.role, role)
      if (target.role === 'owner' && role !== 'owner') throw httpError(403, 'Only an owner can change an owner')
      if (target.role === 'owner' && newRole !== 'owner' && await repo.countOwners(org.id) <= 1) throw httpError(409, 'The organization needs at least one owner')
      await repo.setRole(org.id, target.user_id, newRole)
      return { ok: true }
    }],
    ['DELETE', '/orgs/:id/members/:uid', async (ctx) => {
      const self = ctx.params.uid === requireUser(ctx).id
      const { org, role } = await orgFor(ctx, ctx.params.id, self ? 'viewer' : 'admin')
      const target = await repo.membership(org.id, ctx.params.uid)
      if (!target) throw httpError(404, 'Member not found')
      if (target.role === 'owner' && !self && role !== 'owner') throw httpError(403, 'Only an owner can remove an owner')
      if (target.role === 'owner' && await repo.countOwners(org.id) <= 1) throw httpError(409, 'The organization needs at least one owner')
      await repo.removeMember(org.id, target.user_id)
      return { ok: true }
    }],

    // SMTP of the organization
    ['GET', '/orgs/:id/smtp', async (ctx) => smtpView((await orgFor(ctx, ctx.params.id, 'admin')).org)],
    ['PUT', '/orgs/:id/smtp', async (ctx) => {
      const { org } = await orgFor(ctx, ctx.params.id, 'admin')
      const b = ctx.body
      const host = String(b.host || '').trim()
      if (host && !/^[a-z0-9.-]+$/i.test(host)) throw httpError(400, 'Invalid SMTP host')
      const port = Number(b.port || 587)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw httpError(400, 'Invalid SMTP port')
      const passEnc = b.password === undefined || b.password === null ? org.smtp?.passEnc || '' : encrypt(config.secret, b.password)
      await repo.setOrgSmtp(org.id, host ? { host, port, secure: !!b.secure, user: String(b.user || ''), passEnc, from: String(b.from || '').trim() } : {})
      workspaces.invalidate(org.id)
      return smtpView(await repo.orgById(org.id))
    }],
    ['POST', '/orgs/:id/smtp/test', async (ctx) => {
      const { org, user } = await orgFor(ctx, ctx.params.id, 'admin')
      const { message } = await sender.enqueue(org, {
        to: ctx.body.to || user.email,
        subject: `SMTP test · ${org.name}`,
        html: `<!doctype html><html lang="en"><head><title>SMTP test</title></head><body><p>The SMTP of <b>${escapeHtml(org.name)}</b> works.</p></body></html>`,
      }, { userId: user.id })
      return messageView(message)
    }],

    // API keys
    ['GET', '/orgs/:id/keys', async (ctx) => await repo.apiKeys((await orgFor(ctx, ctx.params.id, 'admin')).org.id)],
    ['POST', '/orgs/:id/keys', async (ctx) => {
      const { org, user } = await orgFor(ctx, ctx.params.id, 'admin')
      const prefix = randomToken(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).padEnd(8, '0')
      const key = `tpl_${prefix}_${randomToken(24)}`
      const row = await repo.createApiKey({ orgId: org.id, name: String(ctx.body.name || 'API key').slice(0, 60), prefix, keyHash: hashToken(config.secret, key), createdBy: user.id })
      return { ...row, key } // shown once
    }],
    ['DELETE', '/orgs/:id/keys/:kid', async (ctx) => {
      await repo.revokeApiKey((await orgFor(ctx, ctx.params.id, 'admin')).org.id, ctx.params.kid)
      return { ok: true }
    }],

    // send log
    ['GET', '/orgs/:id/messages', async (ctx) => {
      const { org } = await orgFor(ctx, ctx.params.id)
      return (await repo.messages(org.id, { limit: ctx.query.get('limit'), before: Number(ctx.query.get('before')) || null, status: ctx.query.get('status') || null })).map(messageView)
    }],
    ['GET', '/orgs/:id/messages/:mid', async (ctx) => {
      const { org } = await orgFor(ctx, ctx.params.id)
      const m = await repo.message(org.id, ctx.params.mid)
      if (!m) throw httpError(404, 'Message not found')
      return { ...messageView(m), html: m.payload.html, text: m.payload.text }
    }],

    // send API (API keys)
    ['POST', '/v1/send', async (ctx) => {
      const { org, key } = await apiKeyOrg(ctx.req)
      const { message, replayed, warnings } = await sender.enqueue(org, ctx.body, { apiKeyId: key.id, idempotencyKey: ctx.req.headers['idempotency-key'] })
      ctx.status = replayed ? 200 : 202
      return { ...messageView(message), warnings: warnings?.length ? warnings : undefined }
    }],
    ['POST', '/v1/render', async (ctx) => {
      const { org } = await apiKeyOrg(ctx.req)
      const b = await sender.build(org, { to: 'render@example.com', ...ctx.body })
      return { subject: b.subject, html: b.html, text: b.text, locale: b.locale, attachments: b.attachments?.names ?? b.attachments?.list?.map(a => a.filename) ?? [], warnings: b.warnings }
    }],
    ['GET', '/v1/messages/:mid', async (ctx) => {
      const { org } = await apiKeyOrg(ctx.req)
      const m = await repo.message(org.id, ctx.params.mid)
      if (!m) throw httpError(404, 'Message not found')
      return messageView(m)
    }],
    ['GET', '/v1/templates', async (ctx) => {
      const { org } = await apiKeyOrg(ctx.req)
      const ws = await workspaces.get(org.id)
      return listTemplates(ws.project).map(t => ({ id: t.id, format: t.format, langs: t.langs }))
    }],
  ].map(([method, pattern, fn]) => ({ method, fn, ...compile(pattern) }))

  // ── request handler ──
  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost')
    if (config.trustProxy) req.clientIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    try {
      const isApiV1 = url.pathname.startsWith('/v1/')
      // cookie-authenticated writes must come from our own origin (CSRF)
      if (!isApiV1 && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const o = req.headers.origin
        if (o ? o !== origin : req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Cross-site request blocked')
      }
      const ctx = { req, res, query: url.searchParams, auth: isApiV1 ? null : await auth.sessionOf(req), status: 200 }

      // org-scoped editor API and static files of the active org
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/static/')) return await editorRequest(ctx, url)

      for (const r of routes) {
        if (r.method !== req.method) continue
        const m = url.pathname.match(r.re)
        if (!m) continue
        ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
        ctx.body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readJson(req, isApiV1 ? 40 * 1024 * 1024 : 2 * 1024 * 1024) : {}
        const out = await r.fn(ctx)
        if (!res.headersSent) sendJson(res, out, ctx.status)
        return
      }
      if (req.method === 'GET' && !isApiV1 && !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/orgs')) return serveEditor(res, url.pathname, editorDist)
      throw httpError(404, 'Route not found')
    } catch (err) {
      if (!err.status) log?.(err)
      if (!res.headersSent) sendJson(res, { error: err.status ? err.message : 'Internal error' }, err.status || 500)
      else res.end()
    }
  }

  async function editorRequest(ctx, url) {
    const user = requireUser(ctx)
    const orgId = ctx.auth.session.active_org_id
    const m = orgId && await repo.membership(orgId, user.id)
    if (!m) throw httpError(409, 'Choose or create an organization first')
    const write = !['GET', 'HEAD'].includes(ctx.req.method)
    if (write && !roleAtLeast(m.role, 'editor') && !(ctx.req.method === 'POST' && VIEWER_POSTS.has(url.pathname))) {
      throw httpError(403, 'Your role in this organization is read-only (viewer)')
    }
    const ws = await workspaces.get(orgId)
    if (write && storage.driver === 'db' && !VIEWER_POSTS.has(url.pathname)) {
      // db storage: the changes reach the database before the response is sent (read-your-writes,
      // also from other instances)
      const res = ctx.res
      const end = res.end.bind(res)
      res.end = (...args) => {
        const finish = () => end(...args)
        if (res.statusCode >= 400) return finish()
        // (on error the headers are already written: the change stays in the cache and the next sync,
        // which compares every file, stores it)
        storage.sync(ws.org).then(finish, (err) => { log?.(`db storage sync (${ws.org.slug}): ${err.message}`); finish() })
        return res
      }
    }
    await ws.handler(ctx.req, ctx.res)
  }

  return {
    handler,
    repo,
    mailer,
    sender,
    storage,
    workspaces,
    /** Hourly housekeeping: expired sessions/codes/challenges and the send-log retention */
    async maintenance() {
      await repo.deleteExpired()
      const purged = config.send.retentionDays > 0 ? await repo.purgePayloads(Date.now() - config.send.retentionDays * 86400e3) : 0
      return { purged }
    },
    async close() {
      await sender.stop()
      await db.close()
    },
  }
}

function compile(pattern) {
  const keys = []
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' })}$`)
  return { re, keys }
}

function checkRole(role, actorRole) {
  if (!ROLES.includes(role)) throw httpError(400, `Unknown role ${role} (${ROLES.join(', ')})`)
  if (role === 'owner' && actorRole !== 'owner') throw httpError(403, 'Only an owner can grant the owner role')
  return role
}

async function uniqueSlug(repo, text) {
  const base = String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org'
  let slug = base
  for (let i = 2; await repo.orgBySlug(slug); i++) slug = `${base}-${i}`
  return slug
}

function serveEditor(res, pathname, root) {
  let file = path.resolve(root, `.${decodeURIComponent(pathname)}`)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('The editor is not built: run `npm run build`')
  }
  const immutable = /\/assets\//.test(file)
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
  fs.createReadStream(file).pipe(res)
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
