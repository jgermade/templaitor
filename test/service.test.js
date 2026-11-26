// Hosted service: login, organizations, roles, org-scoped editor API, send API and storage drivers.
import { test, describe, before, after } from 'node:test'
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

// Postgres runs only when a server is given: TEMPLAITOR_TEST_POSTGRES_URL=postgres://user@host:port/postgres
const PG_URL = process.env.TEMPLAITOR_TEST_POSTGRES_URL
const DRIVERS = [['sqlite', null], ...(PG_URL ? [['postgres', PG_URL]] : [])]

/** A fresh, empty Postgres database for one service instance (dropped by close()) */
async function freshPostgres(adminUrl) {
  const { default: pg } = await import('pg')
  const name = `tpl_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return {
    url: url.href,
    async drop() {
      const c = new pg.Client({ connectionString: adminUrl })
      await c.connect()
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await c.end()
    },
  }
}

async function startService(overrides = {}, pgAdminUrl = null) {
  const pgDb = pgAdminUrl ? await freshPostgres(pgAdminUrl) : null
  if (pgDb) overrides = { ...overrides, database: { driver: 'postgres', url: pgDb.url } }
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
  const app = await createApp(config, { transportFactory, mailTransportFactory: () => ({ sendMail: async () => ({}) }), log: process.env.DEBUG_SVC ? console.log : null })
  server.on('request', app.handler)
  return {
    app, baseUrl, sent, config,
    failWith: (e) => { failNext = e },
    async close() { await app.close(); await new Promise(r => server.close(r)); await pgDb?.drop() },
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

for (const [driver, pgUrl] of DRIVERS) describe(`hosted service on ${driver}`, () => {
  let svc
  before(async () => { svc = await startService({}, pgUrl) })
  after(async () => { await svc?.close() })

  test(`service (${driver}): email OTP login, wrong codes and session`, async () => {
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

  test(`service (${driver}): organizations, org-scoped editor, roles and CSRF`, async () => {
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

  test(`service (${driver}): send API — hosted template (with its PDF attachment), raw HTML, idempotency and retries`, { timeout: 120000 }, async () => {
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
    assert.notEqual((await svc.app.repo.orgById(org.id)).smtp.passEnc, 's3cret') // encrypted at rest

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

    // data contract: data that does not match is refused (422 with the errors), nothing is queued
    const before = (await svc.app.repo.messages(org.id)).length
    const refused = await api('/v1/send', { template: 'orders/order-confirmation', lang: 'en', data: { ...data, items: 'none', first_name: undefined }, to: 'ada@example.com' })
    assert.equal(refused.status, 422)
    assert.match(refused.data.error, /does not match the contract of orders\/order-confirmation/)
    assert.deepEqual(refused.data.details.map(d => [d.path, d.message]), [['first_name', 'is required'], ['items', 'must be a list']])
    assert.equal((await svc.app.repo.messages(org.id)).length, before)
    // the contract as JSON Schema
    const schema = (await api('/v1/schema?template=orders/order-confirmation')).data
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.ok(schema.required.includes('items'))
    assert.equal(schema.properties.items.type, 'array')

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
    await svc.app.repo.db.run('UPDATE messages SET next_attempt_at = 0 WHERE id = ?', first.data.id)
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

  test(`service (${driver}): two instances share the queue without double sends; retention purges old content`, { timeout: 60000 }, async () => {
    const ada = client(svc)
    await ada.login('queue@example.com')
    const org = (await ada.post('/orgs', { name: 'Queue Org' })).data
    await ada.put(`/orgs/${org.id}/smtp`, { host: 'smtp.queue.test', from: 'Q <no-reply@queue.test>' })
    const { key } = (await ada.post(`/orgs/${org.id}/keys`, { name: 'k' })).data
    // Postgres: a second instance on the same database, with its own SMTP transport
    // (SQLite is single-instance: concurrent drains inside one instance)
    const sentB = []
    const appB = driver === 'sqlite' ? svc.app : await createApp(svc.config, { log: null, transportFactory: () => ({ sendMail: async (m) => { sentB.push(m); return { messageId: 'b' } } }) })
    await svc.app.sender.stop() // no automatic drain: both instances drain together below
    const ids = []
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${svc.baseUrl}/v1/send`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: `n${i}@example.com`, subject: `#${i}`, html: `<p>${i}</p>` }),
      })
      ids.push((await r.json()).id)
    }
    const before = svc.sent.length
    svc.app.sender.resume()
    await Promise.all([svc.app.sender.tick(), appB.sender.tick(), svc.app.sender.tick(), appB.sender.tick()])
    const subjects = [...svc.sent.slice(before), ...sentB].map(m => m.subject).filter(s => s.startsWith('#'))
    assert.equal(subjects.length, 12, 'each message is delivered once')
    assert.equal(new Set(subjects).size, 12)
    for (const id of ids) assert.equal((await svc.app.repo.message(org.id, id)).status, 'sent')

    // retention: content of messages older than retentionDays is purged, metadata stays
    await svc.app.repo.db.run('UPDATE messages SET created_at = ? WHERE id = ?', Date.now() - 40 * 86400e3, ids[0])
    const { purged } = await svc.app.maintenance()
    assert.equal(purged, 1)
    const old = (await ada.get(`/orgs/${org.id}/messages/${ids[0]}`)).data
    assert.equal(old.subject, '#0')
    assert.equal(old.html, undefined)
    assert.equal(old.purged, true)
    if (appB !== svc.app) await appB.close()
  })

  test(`service (${driver}): template versions — git commits with fs storage, database rows with db storage`, async () => {
    // fs storage: the org's folder is a git repository from the start (scaffold commits it)
    const dave = client(svc)
    await dave.login('dave@example.com')
    await dave.patch('/auth/me', { name: 'Dave' })
    const org = (await dave.post('/orgs', { name: 'Versioned' })).data
    let list = (await dave.get('/api/versions?id=general/welcome')).data
    assert.equal(list.backend, 'git')
    assert.deepEqual(list.versions.map(v => v.message), ['Initial version'])
    const tpl = (await dave.get('/api/template?id=general/welcome')).data
    assert.equal((await dave.put('/api/template', { ...tpl, mjml: tpl.mjml.replace("$t('body')", 'Version two') })).status, 200)
    assert.equal((await dave.get('/api/versions?id=general/welcome')).data.dirty, true)
    const v2 = (await dave.post('/api/versions', { id: 'general/welcome', message: 'Second' })).data
    assert.equal(v2.number, 2)
    assert.equal(v2.author, 'Dave')
    assert.equal(v2.email, 'dave@example.com')
    assert.equal((await dave.post('/api/versions', { id: 'general/welcome' })).status, 409) // nothing new
    list = (await dave.get('/api/versions?id=general/welcome')).data
    const old = (await dave.get(`/api/version?id=general/welcome&rev=${list.versions[1].rev}`)).data
    assert.match(old.mjml, /\$t\('body'\)/)
    assert.equal((await dave.post('/api/versions/init', {})).status, 409)

    // send API with a pinned version: v1 renders the old text although the files hold v2 (plus an unversioned edit)
    const { key } = (await dave.post(`/orgs/${org.id}/keys`, { name: 'backend' })).data
    const api = (url, body) => fetch(svc.baseUrl + url, {
      method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    }).then(async r => ({ status: r.status, data: await r.json() }))
    await dave.put('/api/template', { ...tpl, mjml: tpl.mjml.replace("$t('body')", 'Not versioned yet') })
    const render = (version) => api('/v1/render', { template: 'general/welcome', lang: 'en', ...(version === undefined ? {} : { version }) })
    assert.match((await render()).data.html, /Not versioned yet/)
    assert.equal((await render()).data.version, null)
    for (const spec of [1, 'v1', list.versions[1].rev, list.versions[1].short]) {
      const r = (await render(spec)).data
      assert.doesNotMatch(r.html, /Version two|Not versioned yet/, String(spec))
      assert.equal(r.version.number, 1, String(spec))
      assert.equal(r.version.rev, list.versions[1].rev)
    }
    const latest = (await render('latest')).data
    assert.match(latest.html, /Version two/)
    assert.equal(latest.version.number, 2)
    assert.equal((await render(7)).status, 404)
    assert.equal((await render(0)).status, 404)
    assert.equal((await render('HEAD~1')).status, 400)
    assert.equal((await render({ n: 1 })).status, 400)
    const vlist = (await api('/v1/versions?template=general/welcome')).data
    assert.deepEqual(vlist.versions.map(v => [v.number, v.message]), [[2, 'Second'], [1, 'Initial version']])
    await dave.put(`/orgs/${org.id}/smtp`, { host: 'smtp.versioned.test', from: 'V <no-reply@versioned.test>' })
    const sent = await api('/v1/send', { template: 'general/welcome', lang: 'en', version: 'v1', to: 'x@example.com' })
    assert.equal(sent.status, 202, JSON.stringify(sent.data))
    assert.equal(sent.data.version.number, 1)
    assert.equal((await api(`/v1/messages/${sent.data.id}`)).data.version.rev, list.versions[1].rev)
    // viewers list and read versions but cannot save them
    await dave.post(`/orgs/${org.id}/invitations`, { email: 'erin@example.com', role: 'viewer' })
    const erin = client(svc)
    await erin.login('erin@example.com')
    await erin.post(`/orgs/${org.id}/activate`)
    assert.equal((await erin.get('/api/versions?id=general/welcome')).data.versions.length, 2)
    assert.equal((await erin.post('/api/versions', { id: 'general/welcome' })).status, 403)
    // shareable preview URL of the org's template (members only)
    const pv = await erin.get('/preview/general/welcome?lang=en&version=v1')
    assert.equal(pv.status, 200)
    assert.match(String(pv.data), /<base href="\.\.\/\.\.\/">/)
    assert.equal((await client(svc).get('/preview/general/welcome')).status, 401)

    // db storage: versions are rows, numbered per document
    const s = await startService({ storage: { driver: 'db' } }, pgUrl)
    try {
      const c = client(s)
      await c.login('frank@example.com')
      await c.post('/orgs', { name: 'Db Versions' })
      list = (await c.get('/api/versions?id=general/welcome')).data
      assert.equal(list.backend, 'db')
      assert.deepEqual(list.versions, [])
      assert.equal(list.dirty, true) // never versioned
      const v1 = (await c.post('/api/versions', { id: 'general/welcome', message: 'First' })).data
      assert.deepEqual([v1.number, v1.short, v1.message, v1.email], [1, 'v1', 'First', 'frank@example.com'])
      assert.equal((await c.post('/api/versions', { id: 'general/welcome' })).status, 409)
      const t = (await c.get('/api/template?id=general/welcome')).data
      await c.put('/api/template', { ...t, mjml: t.mjml.replace("$t('body')", 'Edited') })
      assert.equal((await c.get('/api/versions?id=general/welcome')).data.dirty, true)
      const v2db = (await c.post('/api/versions', { id: 'general/welcome', message: '' })).data
      assert.deepEqual([v2db.number, v2db.message], [2, 'Update general/welcome'])
      list = (await c.get('/api/versions?id=general/welcome')).data
      assert.deepEqual(list.versions.map(v => v.number), [2, 1])
      assert.equal(list.dirty, false)
      const r1 = (await c.get(`/api/version?id=general/welcome&rev=${v1.id}`)).data
      assert.match(r1.mjml, /\$t\('body'\)/)
      assert.equal(r1.number, 1)
      assert.equal((await c.get('/api/version?id=general/welcome&rev=nope')).status, 400)
      assert.equal((await c.post('/api/versions/init', {})).status, 400)
      // pinned version with db storage
      const org2 = (await c.get('/orgs')).data[0]
      const { key: k2 } = (await c.post(`/orgs/${org2.id}/keys`, { name: 'b' })).data
      const r2 = (v) => fetch(`${s.baseUrl}/v1/render`, { method: 'POST', headers: { Authorization: `Bearer ${k2}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template: 'general/welcome', version: v }) }).then(r => r.json())
      assert.doesNotMatch((await r2('v1')).html, /Edited/)
      assert.match((await r2(2)).html, /Edited/)
      assert.deepEqual((await r2(v1.id)).version, { number: 1, rev: v1.id, short: 'v1' })
    } finally {
      await s.close()
    }
  })

  test(`service (${driver}): db storage driver keeps the projects in the database`, async () => {
    const s = await startService({ storage: { driver: 'db' } }, pgUrl)
    try {
      const c = client(s)
      await c.login('carol@example.com')
      const org = (await c.post('/orgs', { name: 'Db Org' })).data
      assert.equal(org.storage, 'db')
      const tpl = (await c.get('/api/template?id=general/welcome')).data
      assert.equal((await c.put('/api/template', { ...tpl, mjml: tpl.mjml.replace('$t(\'body\')', 'Stored in the DB') })).status, 200)
      const row = await s.app.repo.db.get('SELECT content FROM files WHERE org_id = ? AND path = ?', org.id, 'templates/general/welcome/welcome.mjml')
      assert.match(Buffer.from(row.content).toString(), /Stored in the DB/)
      // a new instance (empty cache) materializes the project from the database
      fs.rmSync(s.config.storage.cacheDir, { recursive: true, force: true })
      s.app.workspaces.invalidate(org.id)
      const s2app = await createApp(s.config, { log: null })
      const ws = await s2app.workspaces.get(org.id)
      assert.match(fs.readFileSync(path.join(ws.project.templatesDir, 'general/welcome/welcome.mjml'), 'utf8'), /Stored in the DB/)
      await s2app.close()

      if (driver === 'postgres') {
        // two live instances (each with its own cache): what one saves, the other serves
        const appB = await createApp({ ...s.config, storage: { ...s.config.storage, cacheDir: `${s.config.storage.cacheDir}-b` } }, { log: null })
        const wsB = await appB.workspaces.get(org.id)
        const fileB = path.join(wsB.project.templatesDir, 'general/welcome/welcome.mjml')
        assert.equal((await c.put('/api/template', { ...tpl, mjml: tpl.mjml.replace('$t(\'body\')', 'Second edit') })).status, 200)
        await appB.workspaces.get(org.id)
        assert.match(fs.readFileSync(fileB, 'utf8'), /Second edit/)
        // B writes (as its editor API would) → A serves it
        fs.writeFileSync(fileB, fs.readFileSync(fileB, 'utf8').replace('Second edit', 'Edited on B'))
        await appB.storage.sync(wsB.org)
        assert.match((await c.get('/api/template?id=general/welcome')).data.mjml, /Edited on B/)
        // SMTP changed on A is used by B's editor (test sends)
        await c.put(`/orgs/${org.id}/smtp`, { host: 'smtp.b.test', from: 'X <x@b.test>' })
        assert.equal((await appB.workspaces.get(org.id)).project.smtp.host, 'smtp.b.test')
        await appB.close()
      }
    } finally {
      await s.close()
    }
  })
})

after(() => setPdfSandbox(false))

test('service: project mode serves one deployed project (read-only, env API keys, admins, snapshot versions)', { timeout: 60000 }, async () => {
  const { execFileSync } = await import('node:child_process')
  const { exportVersions } = await import('../src/engine/snapshot.js')
  const { loadProject } = await import('../src/engine/project.js')
  // the "repository": its root project with two commits, exported and deployed without .git
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-deploy-'))
  const root = path.resolve(import.meta.dirname, '..')
  fs.copyFileSync(path.join(root, 'templaitor.config.yml'), path.join(repoDir, 'templaitor.config.yml'))
  fs.cpSync(path.join(root, 'templates'), path.join(repoDir, 'templates'), { recursive: true })
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...a], { cwd: repoDir, stdio: 'pipe' })
  git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'first')
  const tplFile = path.join(repoDir, 'templates/customers/email-verification/email-verification.yml')
  const before = fs.readFileSync(tplFile, 'utf8')
  const subject = before.match(/^ {2}en: "?(.+?)"?$/m)?.[1]
  fs.writeFileSync(tplFile, before.replace(subject, 'Deployed subject'))
  git('commit', '-q', '-am', 'second')
  await exportVersions(loadProject(repoDir))
  fs.rmSync(path.join(repoDir, '.git'), { recursive: true, force: true })

  const KEY = 'deploy-key-0123456789abcdef'
  const s = await startService({ project: repoDir, apiKeys: [KEY], admins: ['ops@example.com'], smtp: { host: 'smtp.deploy.test', from: 'Deploy <no-reply@deploy.test>' } })
  try {
    assert.equal(s.config.signup, 'invite')
    const api = (url, body, key = KEY) => fetch(s.baseUrl + url, {
      method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    }).then(async r => ({ status: r.status, data: await r.json() }))
    assert.deepEqual((await api('/v1/templates')).data.map(t => t.id), ['customers/email-verification', 'documents/invoice', 'orders/order-confirmation'])
    assert.equal((await api('/v1/templates', undefined, 'wrong-key-0123456789abcdef')).status, 401)
    const data = { first_name: 'Ada', verification_token: 'tok-123', app_url: 'https://x.test', assets_url: 'https://x.test/static', year: 2026 }
    assert.equal((await api('/v1/render', { template: 'customers/email-verification', lang: 'en', data })).data.subject, 'Deployed subject')
    const v1 = (await api('/v1/render', { template: 'customers/email-verification', lang: 'en', data, version: 'v1' })).data
    assert.notEqual(v1.subject, 'Deployed subject')
    assert.equal(v1.version.number, 1)
    const versions = (await api('/v1/versions?template=customers/email-verification')).data.versions
    assert.deepEqual(versions.map(v => v.message), ['second', 'first'])
    // sending uses the deployment's SMTP
    const sent = await api('/v1/send', { template: 'customers/email-verification', lang: 'en', data, to: 'ada@example.com', version: 2 })
    assert.equal(sent.status, 202, JSON.stringify(sent.data))
    await s.app.sender.tick()
    assert.equal(s.sent.at(-1).subject, 'Deployed subject')
    assert.equal(s.sent.at(-1).from, 'Deploy <no-reply@deploy.test>')

    // the admin signs in: read-only editor of the project, no new organizations
    const ops = client(s)
    await ops.login('ops@example.com')
    const session = (await ops.get('/auth/session')).data
    assert.equal(session.activeOrg.slug, 'project')
    assert.equal(session.activeOrg.role, 'owner')
    assert.equal(session.activeOrg.readOnly, true)
    const tpl = (await ops.get('/api/template?id=customers/email-verification')).data
    assert.equal((await ops.put('/api/template', tpl)).status, 403)
    assert.equal((await ops.post('/api/preview', { ...tpl, lang: 'en', mode: 'preview' })).status, 200)
    assert.equal((await ops.get('/api/versions?id=customers/email-verification')).data.backend, 'snapshot')
    assert.equal((await ops.post('/orgs', { name: 'Other' })).status, 403)
    // signup is by invitation
    await client(s).post('/auth/code', { email: 'stranger@example.com' })
    assert.equal(s.app.mailer.outbox.some(m => m.to === 'stranger@example.com'), false) // no code is sent
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
