// Hosted service: login, organizations, roles, org-scoped editor API, send API and storage drivers.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { loadServiceConfig } from '../src/service/config.js'
import { createApp } from '../src/service/app.js'
import { isPrivateAddress, safeFetch } from '../src/service/netguard.js'
import { encrypt, decrypt } from '../src/service/crypto.js'
import { listEngines, setPdfSandbox } from '../src/engine/pdf.js'

const SECRET = 'test-secret-0123456789-0123456789-abcdef'

async function startService(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-svc-'))
  const sent = []
  let failNext = null
  const transportFactory = () => ({
    sendMail: async (msg) => {
      if (failNext) { const e = failNext; failNext = null; throw e }
      sent.push(msg)
      return { messageId: `<${sent.length}@test>` }
    },
  })
  const server = http.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const config = loadServiceConfig({ cwd: dataDir, env: {}, overrides: { secret: SECRET, dataDir, baseUrl, ...overrides } })
  const app = await createApp(config, { transportFactory, log: null })
  server.on('request', app.handler)
  return {
    app, baseUrl, sent, config,
    failWith: (e) => { failNext = e },
    async close() { await app.close(); await new Promise(r => server.close(r)) },
  }
}

/** Minimal cookie-keeping client */
function client(svc) {
  let cookies = {}
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(svc.baseUrl + url, {
      method,
      headers: {
        Origin: svc.baseUrl,
        Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';')
      const [k, v] = kv.split('=')
      if (/Max-Age=0/.test(c)) delete cookies[k]; else cookies[k] = v
    }
    const type = res.headers.get('content-type') || ''
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
    return { status: res.status, data, headers: res.headers }
  }
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    put: (u, b = {}, h) => call('PUT', u, b, h),
    patch: (u, b = {}, h) => call('PATCH', u, b, h),
    del: (u, b = {}, h) => call('DELETE', u, b, h),
    async login(email) {
      assert.equal((await call('POST', '/auth/code', { email })).status, 200)
      const mail = svc.app.mailer.outbox.findLast(m => m.to === email)
      const code = mail.text.match(/\b(\d{6})\b/)[1]
      const r = await call('POST', '/auth/code/verify', { email, code })
      assert.equal(r.status, 200, JSON.stringify(r.data))
    },
  }
}

let svc
before(async () => { svc = await startService() })
after(async () => { await svc?.close(); setPdfSandbox(false) })

test('service: email OTP login, wrong codes and session', async () => {
  const c = client(svc)
  assert.equal((await c.get('/auth/session')).data.user, null)
  assert.equal((await c.get('/api/templates')).status, 401)
  await c.post('/auth/code', { email: 'Wrong@Example.com' })
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/auth/code/verify', { email: 'wrong@example.com', code: '000000x' })).status, 400)
  const fifth = await c.post('/auth/code/verify', { email: 'wrong@example.com', code: '000000x' })
  assert.match(fifth.data.error, /request a new one/)
  // even the right code is refused after 5 attempts
  const code = svc.app.mailer.outbox.findLast(m => m.to === 'wrong@example.com').text.match(/\b(\d{6})\b/)[1]
  assert.equal((await c.post('/auth/code/verify', { email: 'wrong@example.com', code })).status, 400)

  await c.login('ada@example.com')
  const s = (await c.get('/auth/session')).data
  assert.equal(s.user.email, 'ada@example.com')
  assert.deepEqual(s.orgs, [])
  assert.equal((await c.get('/api/templates')).status, 409) // no organization yet
  await c.post('/auth/logout')
  assert.equal((await c.get('/auth/session')).data.user, null)
})

test('service: organizations, org-scoped editor, roles and CSRF', async () => {
  const ada = client(svc)
  await ada.login('ada@example.com')
  const org = (await ada.post('/orgs', { name: 'Acme Corp', starter: 'demo' })).data
  assert.equal(org.slug, 'acme-corp')
  assert.equal(org.role, 'owner')
  const tpls = (await ada.get('/api/templates')).data
  assert.ok(tpls.some(t => t.id === 'orders/order-confirmation'))
  const blank = (await ada.post('/orgs', { name: 'Acme Corp' })).data
  assert.equal(blank.slug, 'acme-corp-2')
  assert.deepEqual((await ada.get('/api/templates')).data.map(t => t.id), ['general/welcome'])
  await ada.post(`/orgs/${org.id}/activate`)

  // cross-site writes are blocked
  assert.equal((await ada.post('/orgs', { name: 'x' }, { Origin: 'https://evil.example' })).status, 403)

  // invite a viewer: read and preview, no writes
  const inv = await ada.post(`/orgs/${org.id}/invitations`, { email: 'bob@example.com', role: 'viewer' })
  assert.equal(inv.status, 200)
  assert.match(svc.app.mailer.outbox.findLast(m => m.to === 'bob@example.com').subject, /invited you to Acme Corp/)
  const bob = client(svc)
  await bob.login('bob@example.com')
  const bs = (await bob.get('/auth/session')).data
  assert.equal(bs.activeOrg.slug, 'acme-corp')
  assert.equal(bs.activeOrg.role, 'viewer')
  const tpl = (await bob.get('/api/template?id=orders/order-confirmation')).data
  assert.equal((await bob.post('/api/preview', { ...tpl, lang: 'en', mode: 'preview' })).status, 200)
  assert.equal((await bob.put('/api/template', { ...tpl, mjml: `${tpl.mjml}\n` })).status, 403)
  assert.equal((await bob.get(`/orgs/${org.id}/keys`)).status, 403)
  assert.equal((await bob.get(`/orgs/${blank.id}`)).status, 404) // not a member

  // promote to editor → can write
  const members = (await ada.get(`/orgs/${org.id}/members`)).data.members
  const bobId = members.find(m => m.email === 'bob@example.com').id
  assert.equal((await ada.patch(`/orgs/${org.id}/members/${bobId}`, { role: 'editor' })).status, 200)
  assert.equal((await bob.put('/api/template', { ...tpl, mjml: tpl.mjml.replace('layout:', '# edited\nlayout:') })).status, 200)
  // the last owner cannot leave
  const adaId = members.find(m => m.email === 'ada@example.com').id
  assert.equal((await ada.del(`/orgs/${org.id}/members/${adaId}`)).status, 409)
  // an editor cannot grant roles
  assert.equal((await bob.patch(`/orgs/${org.id}/members/${adaId}`, { role: 'viewer' })).status, 403)
})

test('service: send API — hosted template (with its PDF attachment), raw HTML, idempotency and retries', { timeout: 120000 }, async () => {
  const ada = client(svc)
  await ada.login('ada@example.com')
  const org = (await ada.get('/orgs')).data.find(o => o.slug === 'acme-corp')
  await ada.post(`/orgs/${org.id}/activate`)
  const noKey = await fetch(`${svc.baseUrl}/v1/send`, { method: 'POST', body: '{}' })
  assert.equal(noKey.status, 401)

  const { key } = (await ada.post(`/orgs/${org.id}/keys`, { name: 'backend' })).data
  assert.match(key, /^tpl_[A-Za-z0-9]{8}_/)
  const api = (url, body, headers = {}) => fetch(svc.baseUrl + url, {
    method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
  }).then(async r => ({ status: r.status, data: await r.json() }))

  // without SMTP the org cannot send
  assert.equal((await api('/v1/send', { to: 'x@example.com', subject: 'a', html: '<p>a</p>' })).status, 409)
  const smtp = await ada.put(`/orgs/${org.id}/smtp`, { host: 'smtp.acme.test', port: 587, user: 'acme', password: 's3cret', from: 'Acme <no-reply@acme.test>' })
  assert.deepEqual(smtp.data, { host: 'smtp.acme.test', port: 587, secure: false, user: 'acme', from: 'Acme <no-reply@acme.test>', hasPassword: true })
  assert.notEqual(svc.app.repo.orgById(org.id).smtp.passEnc, 's3cret') // encrypted at rest

  // hosted template in English, with its demo data
  const data = JSON.parse(JSON.stringify((await import('json5')).default.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../examples/demo/templates/orders/order-confirmation/order-confirmation.json5'), 'utf8'))))
  const r = await api('/v1/send', { template: 'orders/order-confirmation', lang: 'en-US', data, to: ['ada@example.com'] })
  assert.equal(r.status, 202, JSON.stringify(r.data))
  assert.equal(r.data.status, 'queued')
  assert.equal(r.data.subject, 'Order #A-1042 confirmed')
  assert.deepEqual(r.data.attachments, ['invoice-2026-0042.pdf'])
  const pdfEngine = listEngines().some(e => e.available && e.id !== 'prince')
  await svc.app.sender.tick()
  const done = (await api(`/v1/messages/${r.data.id}`)).data
  if (pdfEngine) {
    assert.equal(done.status, 'sent', done.lastError)
    const mail = svc.sent.at(-1)
    assert.equal(mail.from, 'Acme <no-reply@acme.test>')
    assert.match(mail.html, /Mechanical keyboard/)
    assert.equal(mail.attachments[0].filename, 'invoice-2026-0042.pdf')
    assert.equal(mail.attachments[0].content.subarray(0, 5).toString(), '%PDF-')
  }

  // render without sending; unknown language
  const rendered = (await api('/v1/render', { template: 'orders/order-confirmation', lang: 'es', data })).data
  assert.equal(rendered.subject, 'Pedido #A-1042 confirmado')
  assert.match((await api('/v1/render', { template: 'orders/order-confirmation', lang: 'fr', data })).data.error, /Language not available/)

  // raw HTML with a base64 attachment + idempotency
  const raw = { to: 'bob@example.com', subject: 'Hi', html: '<p>Hello <b>Bob</b></p>', attachments: [{ filename: 'a.txt', content: Buffer.from('hello').toString('base64') }] }
  // the first delivery attempt hits a temporary SMTP error → retried later
  svc.failWith(Object.assign(new Error('421 try later'), { responseCode: 421 }))
  const first = await api('/v1/send', raw, { 'Idempotency-Key': 'order-1' })
  const again = await api('/v1/send', raw, { 'Idempotency-Key': 'order-1' })
  assert.equal(first.status, 202)
  assert.equal(again.status, 200)
  assert.equal(again.data.id, first.data.id)
  await svc.app.sender.tick()
  let m = (await api(`/v1/messages/${first.data.id}`)).data
  assert.equal(m.status, 'queued')
  assert.equal(m.attempts, 1)
  assert.match(m.lastError, /421/)
  svc.app.repo.db.run('UPDATE messages SET next_attempt_at = 0 WHERE id = ?', first.data.id)
  await svc.app.sender.tick()
  m = (await api(`/v1/messages/${first.data.id}`)).data
  assert.equal(m.status, 'sent')
  assert.match(svc.sent.at(-1).text, /Hello BOB|Hello Bob/)
  assert.equal(svc.sent.at(-1).attachments[0].content.toString(), 'hello')

  // `from` must stay in the org's domain; validation errors
  assert.equal((await api('/v1/send', { ...raw, from: 'ceo@other.test' })).status, 400)
  assert.equal((await api('/v1/send', { subject: 'x', html: '<p>x</p>', to: 'not-an-email' })).status, 400)

  // the send log is visible to members
  const log = (await ada.get(`/orgs/${org.id}/messages`)).data
  assert.ok(log.length >= 2)
  // a revoked key stops working
  const keys = (await ada.get(`/orgs/${org.id}/keys`)).data
  await ada.del(`/orgs/${org.id}/keys/${keys[0].id}`)
  assert.equal((await api('/v1/render', raw)).status, 401)
})

test('service: db storage driver keeps the projects in the database', async () => {
  const s = await startService({ storage: { driver: 'db' } })
  try {
    const c = client(s)
    await c.login('carol@example.com')
    const org = (await c.post('/orgs', { name: 'Db Org' })).data
    assert.equal(org.storage, 'db')
    const tpl = (await c.get('/api/template?id=general/welcome')).data
    assert.equal((await c.put('/api/template', { ...tpl, mjml: tpl.mjml.replace('$t(\'body\')', 'Stored in the DB') })).status, 200)
    const row = s.app.repo.db.get('SELECT content FROM files WHERE org_id = ? AND path = ?', org.id, 'templates/general/welcome/welcome.mjml')
    assert.match(Buffer.from(row.content).toString(), /Stored in the DB/)
    // a new instance (empty cache) materializes the project from the database
    fs.rmSync(s.config.storage.cacheDir, { recursive: true, force: true })
    s.app.workspaces.invalidate(org.id)
    const s2app = await createApp(s.config, { log: null })
    const ws = s2app.workspaces.get(org.id)
    assert.match(fs.readFileSync(path.join(ws.project.templatesDir, 'general/welcome/welcome.mjml'), 'utf8'), /Stored in the DB/)
    await s2app.close()
  } finally {
    await s.close()
  }
})

test('service: SSRF guard and secret encryption', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) assert.ok(isPrivateAddress(ip), ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip)
  await assert.rejects(safeFetch('http://127.0.0.1:1/x'), /blocked private address/)
  await assert.rejects(safeFetch('http://localhost:1/x'), /blocked private address/)
  await assert.rejects(safeFetch('file:///etc/passwd'), /Protocol not allowed/)
  const enc = encrypt(SECRET, 'pässword')
  assert.notEqual(enc, 'pässword')
  assert.equal(decrypt(SECRET, enc), 'pässword')
  assert.throws(() => decrypt('another-secret-0123456789-0123456789-xx', enc))
})
