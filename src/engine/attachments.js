// Email attachments: local PDF templates (rendered in the email's language) and remote files.
import fs from 'node:fs'
import YAML from 'yaml'
import JSON5 from 'json5'
import { normalizeAttachments, defaultFilename } from '../shared/attachments.js'
import { resolveCommands } from './commands.js'
import { parseFrontmatter } from './resolver.js'
import { isPdf } from './pdf.js'
import { templatePaths, toLocale, httpError } from './project.js'

const REMOTE_TIMEOUT = 15000
const REMOTE_MAX_BYTES = 20 * 1024 * 1024

/**
 * Resolves the attachments of a template for one language (compile time).
 * `$` commands are resolved with the email's context; Jinja2 tokens are kept for the runtime.
 * Local entries point to the attached template compiled in the same locale (or its fallback).
 */
export function resolveAttachments(project, meta, ctx) {
  const out = []
  normalizeAttachments(meta.attachments).forEach((att, index) => {
    const filename = resolveCommands(att.filename || defaultFilename(att), ctx).trim()
    if (att.type === 'url') {
      out.push({ index, type: 'url', url: resolveCommands(att.ref, ctx).trim(), filename })
      return
    }
    if (att.type !== 'template' || !att.ref) {
      ctx.warnings.push(`Attachment ${index + 1}: use \`template: <id>\` (local) or \`url: <https://…>\` (remote)`)
      return
    }
    let p
    try { p = templatePaths(project, att.ref) } catch { p = null }
    if (!p || !fs.existsSync(p.mjml)) {
      ctx.warnings.push(`Attachment ${index + 1}: template ${att.ref} does not exist`)
      return
    }
    const { meta: docMeta } = parseFrontmatter(fs.readFileSync(p.mjml, 'utf8'))
    if (!isPdf(docMeta)) ctx.warnings.push(`Attachment ${index + 1}: ${att.ref} is not a PDF template (add \`format: pdf\` to its frontmatter)`)
    // the document is rendered in the email's language (or its first language, with a warning)
    const langs = Object.keys(readYml(p.yml)?.messages || {})
    let langKey = ctx.langKey
    if (langs.length && !langs.includes(langKey)) {
      langKey = langs[0]
      ctx.warnings.push(`Attachment ${index + 1}: ${att.ref} has no "${ctx.langKey}" texts; it is attached in "${langKey}"`)
    }
    const locale = toLocale(project, langKey)
    out.push({
      index,
      type: 'template',
      template: p.id,
      langKey,
      locale,
      context: att.context || null,
      filename,
      // compiled files of the document (relative to outDir)
      html: `${p.id}/${p.name}.${locale}.html`,
      options: `${p.id}/${p.name}.${locale}.pdf.json`,
      contentType: 'application/pdf',
    })
  })
  return out
}

/**
 * Context used to render a local attachment: the email variable named by `context`
 * (or the whole email context). In previews, the document's own demo data fills the gaps.
 */
export function attachmentData(att, emailData = {}, docDemo = {}) {
  if (att.context) {
    const value = att.context.split('.').reduce((o, k) => (o == null ? o : o[k]), emailData)
    return value && typeof value === 'object' ? { ...docDemo, ...value } : docDemo
  }
  return { ...docDemo, ...emailData }
}

/** Demo data of a template (its .json5) */
export function demoDataOf(project, id) {
  const p = templatePaths(project, id)
  try { return fs.existsSync(p.data) ? JSON5.parse(fs.readFileSync(p.data, 'utf8')) : {} } catch { return {} }
}

/**
 * Renders one resolved attachment with real data → { filename, content (Buffer), contentType }.
 * `render(template, data)` renders Jinja2; `renderDocument(id, langKey, data)` returns a PDF Buffer.
 */
export async function renderAttachment(project, att, data, { render, renderDocument, fetchImpl = fetch }) {
  const filename = render(att.filename, data).trim() || 'attachment'
  if (att.type === 'template') {
    const docData = attachmentData(att, data, demoDataOf(project, att.template))
    return { filename, content: await renderDocument(att.template, att.langKey, docData), contentType: att.contentType }
  }
  const url = render(att.url, data).trim()
  if (!/^https?:\/\//i.test(url)) throw httpError(400, `Attachment ${filename}: invalid URL ${url}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT)
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw httpError(502, `Attachment ${filename}: ${url} answered HTTP ${res.status}`)
    const content = Buffer.from(await res.arrayBuffer())
    if (content.length > REMOTE_MAX_BYTES) throw httpError(413, `Attachment ${filename} is larger than 20 MB`)
    return { filename, content, contentType: res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream', url }
  } catch (err) {
    if (err.status) throw err
    throw httpError(502, `Attachment ${filename}: could not download ${url} (${err.name === 'AbortError' ? 'timeout' : err.cause?.code || err.message})`)
  } finally {
    clearTimeout(timer)
  }
}

function readYml(file) {
  try { return fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) : null } catch { return null }
}
