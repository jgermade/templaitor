// Sending service: builds messages (hosted template + data, or raw HTML), queues them in the database
// and delivers them with each organization's SMTP, with retries.
import crypto from 'node:crypto'
import YAML from 'yaml'
import { convert as htmlToText } from 'html-to-text'
import { compileSource, langsOf, renderDraftAttachments } from '../engine/pipeline.js'
import { readTemplate, readLinks } from '../engine/project.js'
import { renderJinja } from '../engine/render.js'
import { resolveVersion } from '../engine/versions.js'
import { httpError } from './http.js'
import { safeFetch } from './netguard.js'

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const MAX_RECIPIENTS = 50
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const BACKOFF = [30e3, 2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3]

export function createSender({ config, repo, workspaces, transportFactory, log = console.log }) {
  const transports = new Map()
  let timer = null
  let running = null // promise of the drain in progress
  let stopped = false

  async function transportFor(org, smtp) {
    const key = `${org.id}:${crypto.createHash('sha1').update(JSON.stringify(smtp)).digest('hex')}`
    if (!transports.has(key)) {
      for (const k of transports.keys()) if (k.startsWith(`${org.id}:`)) transports.delete(k)
      if (transportFactory) transports.set(key, transportFactory(smtp))
      else {
        const { default: nodemailer } = await import('nodemailer')
        transports.set(key, nodemailer.createTransport({
          host: smtp.host, port: smtp.port, secure: smtp.secure, ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
          pool: true, maxConnections: 3,
        }))
      }
    }
    return transports.get(key)
  }

  /** Builds { kind, template, locale, recipients, subject, html, text, attachments… } from an API request */
  async function build(org, body) {
    const recipients = parseRecipients(body)
    const from = fromAddress(org, body.from)
    const headers = { replyTo: body.replyTo ? list(body.replyTo, 'replyTo')[0] : undefined }
    if (body.template) {
      const ws = await workspaces.get(org.id)
      let tpl
      try { tpl = readTemplate(ws.project, body.template) } catch (e) { throw httpError(e.status === 404 ? 404 : 400, e.message) }
      // pinned version (`version: 3 | "v3" | "latest" | <rev>`): the template's own files at that version;
      // layouts, components and attached documents are used as they are now
      let version = null
      if (body.version != null && body.version !== '') {
        if (!['string', 'number'].includes(typeof body.version)) throw httpError(400, '`version` must be a number, "v<n>", "latest" or a revision')
        const v = await resolveVersion(ws.project, tpl.id, 'template', body.version)
        tpl = { ...tpl, mjml: v.mjml, yml: v.yml ?? '' }
        version = { number: v.number ?? null, rev: v.rev, short: v.short }
      }
      const i18n = YAML.parse(tpl.yml || '') || {}
      const langs = langsOf(ws.project, i18n)
      const langKey = resolveLang(ws.project, langs, body.lang)
      const r = await compileSource(ws.project, { mjml: tpl.mjml, i18n, links: readLinks(ws.project), langKey })
      if (r.format !== 'email') throw httpError(400, `${body.template} is a PDF document, not an email`)
      const data = body.data && typeof body.data === 'object' ? body.data : {}
      let subject, html, text
      try {
        subject = renderJinja(r.subject, data).trim()
        html = renderJinja(r.html, data)
        text = renderJinja(r.text, data)
      } catch (e) {
        throw httpError(422, `Jinja2: ${String(e.message).split('\n').pop().trim()}`)
      }
      return {
        kind: 'hosted', template: tpl.id, version, locale: r.locale, recipients, from, headers, subject, html, text,
        // attachments are rendered by the worker from this snapshot (PDF rendering is slow)
        attachments: r.attachments.length ? { snapshot: { mjml: tpl.mjml, yml: tpl.yml, langKey }, data, names: r.attachments.map(a => renderJinja(a.filename, data)) } : null,
        warnings: r.warnings,
      }
    }
    if (typeof body.html !== 'string' || !body.html.trim()) throw httpError(400, 'Send `template` (hosted) or `html` (raw)')
    if (typeof body.subject !== 'string' || !body.subject.trim()) throw httpError(400, '`subject` is required')
    const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map((a, i) => {
      if (!a || typeof a !== 'object' || !a.filename) throw httpError(400, `attachments[${i}]: \`filename\` is required`)
      if (a.url) {
        if (!/^https?:\/\//i.test(a.url)) throw httpError(400, `attachments[${i}]: invalid url`)
        return { filename: String(a.filename), url: a.url, contentType: a.contentType }
      }
      if (typeof a.content !== 'string') throw httpError(400, `attachments[${i}]: send \`content\` (base64) or \`url\``)
      if (a.content.length > MAX_ATTACHMENT_BYTES * 1.4) throw httpError(413, `attachments[${i}] is larger than 20 MB`)
      return { filename: String(a.filename), content: a.content, contentType: a.contentType }
    })
    return {
      kind: 'raw', template: null, version: null, locale: body.lang || null, recipients, from, headers,
      subject: body.subject.trim(), html: body.html, text: typeof body.text === 'string' ? body.text : htmlToText(body.html, { wordwrap: 80 }),
      attachments: attachments.length ? { list: attachments } : null,
      warnings: [],
    }
  }

  function resolveLang(project, langs, lang) {
    if (!lang) return langs[0]
    const want = String(lang)
    // accepts the key (`es`) or the locale (`es-ES`)
    const byKey = langs.find(l => l === want)
    const byLocale = langs.find(l => (project.locales[l] || l).toLowerCase() === want.toLowerCase())
    const found = byKey || byLocale || langs.find(l => l === want.split(/[-_]/)[0].toLowerCase())
    if (!found) throw httpError(400, `Language not available: ${want} (available: ${langs.join(', ')})`)
    return found
  }

  function fromAddress(org, requested) {
    const smtp = workspaces.smtpOf(org)
    const base = smtp?.from || `no-reply@${config.rpId}`
    if (!requested) return base
    const domain = (s) => String(s).match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase()
    if (domain(requested) !== domain(base)) throw httpError(400, `\`from\` must use the organization's domain (${domain(base)})`)
    return requested
  }

  async function renderAttachmentsOf(org, payload) {
    if (!payload.attachments) return []
    if (payload.attachments.snapshot) {
      const ws = await workspaces.get(org.id)
      const out = await renderDraftAttachments(ws.project, payload.attachments.snapshot, { values: payload.attachments.data })
      return out.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType }))
    }
    const out = []
    for (const a of payload.attachments.list) {
      if (a.url) {
        const res = await safeFetch(a.url, { maxBytes: MAX_ATTACHMENT_BYTES })
        if (!res.ok) throw Object.assign(new Error(`Attachment ${a.filename}: ${a.url} answered HTTP ${res.status}`), { retry: res.status >= 500 })
        out.push({ filename: a.filename, content: Buffer.from(await res.arrayBuffer()), contentType: a.contentType || res.headers.get('content-type')?.split(';')[0] })
      } else {
        out.push({ filename: a.filename, content: Buffer.from(a.content, 'base64'), contentType: a.contentType })
      }
    }
    return out
  }

  async function deliver(m) {
    const org = await repo.orgById(m.org_id)
    const smtp = org && workspaces.smtpOf(org)
    if (!smtp) throw Object.assign(new Error('The organization has no SMTP configured'), { permanent: true })
    const p = m.payload
    const attachments = await renderAttachmentsOf(org, p)
    const transport = await transportFor(org, smtp)
    const info = await transport.sendMail({
      from: p.from, to: m.recipients.to, cc: m.recipients.cc, bcc: m.recipients.bcc, replyTo: p.headers?.replyTo,
      subject: m.subject, html: p.html, text: p.text, attachments,
      headers: { 'X-Templaitor-Message-Id': m.id },
    })
    return info.messageId
  }

  /** Processes due messages until the queue is empty (concurrent calls share the same drain) */
  function tick() {
    if (stopped) return Promise.resolve()
    if (!running) running = drain().finally(() => { running = null })
    return running
  }

  async function drain() {
    {
      for (let m = await repo.claimNext(); m && !stopped; m = await repo.claimNext()) {
        try {
          const id = await deliver(m)
          await repo.markSent(m.id, id || null)
        } catch (err) {
          const permanent = err.permanent || (err.responseCode >= 500 && err.responseCode < 600) || err.code === 'EENVELOPE' || err.status === 400
          const msg = String(err.response || err.message || err).slice(0, 500)
          if (permanent || m.attempts >= config.send.maxAttempts) await repo.markFailed(m.id, msg)
          else await repo.markRetry(m.id, msg, Date.now() + BACKOFF[Math.min(m.attempts - 1, BACKOFF.length - 1)])
          log?.(`✉ ${m.id} ${permanent ? 'failed' : `retry ${m.attempts}`}: ${msg}`)
        }
      }
    }
  }

  return {
    build,
    /** Validates, renders and queues a message → message row */
    async enqueue(org, body, { apiKeyId = null, userId = null, idempotencyKey = null } = {}) {
      if (idempotencyKey) {
        const prev = await repo.messageByIdempotencyKey(org.id, String(idempotencyKey).slice(0, 200))
        if (prev) return { message: prev, replayed: true }
      }
      if (!workspaces.smtpOf(org)) throw httpError(409, 'The organization has no SMTP configured (Settings → SMTP)')
      if (await repo.countRecentSends(org.id, Date.now() - 60e3) >= config.send.rateLimitPerMinute) {
        throw httpError(429, `Rate limit: ${config.send.rateLimitPerMinute} messages per minute`)
      }
      const b = await build(org, body)
      const message = await repo.enqueue({
        orgId: org.id, apiKeyId, userId, kind: b.kind, template: b.template, templateVersion: b.version, locale: b.locale, recipients: b.recipients,
        subject: b.subject, idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 200) : null,
        payload: { from: b.from, headers: b.headers, html: b.html, text: b.text, attachments: b.attachments },
      })
      setImmediate(() => tick().catch(e => log?.(e)))
      return { message, warnings: b.warnings }
    },
    tick,
    async start(intervalMs = 2000) {
      stopped = false
      await repo.requeueStuck(10 * 60e3)
      timer = setInterval(() => { tick().catch(e => log?.(e)) }, intervalMs)
      timer.unref?.()
    },
    /** Lets tick() drain again after stop() (without the interval) */
    resume() { stopped = false },
    async stop() {
      stopped = true
      clearInterval(timer)
      await running
      for (const t of transports.values()) t.close?.()
    },
  }
}

/** Public view of a message (no payload) */
export function messageView(m) {
  return {
    id: m.id, status: m.status, kind: m.kind, template: m.template, version: m.template_version ?? null, locale: m.locale, subject: m.subject,
    to: m.recipients.to, cc: m.recipients.cc, bcc: m.recipients.bcc, attempts: m.attempts,
    attachments: m.payload?.attachments?.names ?? m.payload?.attachments?.list?.map(a => a.filename) ?? [],
    lastError: m.last_error, smtpMessageId: m.smtp_message_id, purged: !!m.payload?.purged,
    createdAt: m.created_at, sentAt: m.sent_at, nextAttemptAt: m.status === 'queued' ? m.next_attempt_at : null,
  }
}

function list(v, field) {
  const arr = (Array.isArray(v) ? v : String(v ?? '').split(',')).map(s => String(s).trim()).filter(Boolean)
  for (const a of arr) {
    const addr = a.match(/<([^>]+)>\s*$/)?.[1] ?? a
    if (!EMAIL_RE.test(addr)) throw httpError(400, `${field}: invalid address ${a}`)
  }
  return arr
}

function parseRecipients(body) {
  const r = { to: list(body.to, 'to'), cc: list(body.cc, 'cc'), bcc: list(body.bcc, 'bcc') }
  if (!r.to.length) throw httpError(400, '`to` is required')
  if (r.to.length + r.cc.length + r.bcc.length > MAX_RECIPIENTS) throw httpError(400, `At most ${MAX_RECIPIENTS} recipients per message`)
  return r
}
