// A project template rendered for one recipient: language, optional pinned version, data → subject, HTML,
// text and attachments. Shared by the send API of the hosted service and the programmatic engine (src/index.js).
import YAML from 'yaml'
import { compileSource, langsOf, renderDraftAttachments, renderDraftPdf } from './pipeline.js'
import { readTemplate, readLinks, httpError } from './project.js'
import { renderJinja } from './render.js'
import { resolveVersion } from './versions.js'

/** Language key of a template from a key (`es`), a locale (`es-ES`) or a locale's language (`es-MX` → `es`) */
export function resolveLang(project, langs, lang) {
  if (!lang) return langs[0]
  const want = String(lang)
  const found = langs.find(l => l === want)
    || langs.find(l => (project.locales[l] || l).toLowerCase() === want.toLowerCase())
    || langs.find(l => l === want.split(/[-_]/)[0].toLowerCase())
  if (!found) throw httpError(400, `Language not available: ${want} (available: ${langs.join(', ')})`)
  return found
}

/** The template's own files, at a version when `version` is given → { tpl, version } */
export async function templateSource(project, id, version) {
  let tpl
  try { tpl = readTemplate(project, id) } catch (e) { throw httpError(e.status === 404 ? 404 : 400, e.message) }
  if (version == null || version === '') return { tpl, version: null }
  if (!['string', 'number'].includes(typeof version)) throw httpError(400, '`version` must be a number, "v<n>", "latest" or a revision')
  const v = await resolveVersion(project, tpl.id, 'template', version)
  return { tpl: { ...tpl, mjml: v.mjml, yml: v.yml ?? '' }, version: { number: v.number ?? null, rev: v.rev, short: v.short } }
}

/**
 * Renders an email template with the recipient's data →
 *   { template, format, locale, lang, subject, html, text, version, attachments: [{ filename, … }], warnings, snapshot }
 * `attachments` lists the resolved attachments (names rendered with the data); `snapshot` is what
 * renderAttachments() needs to produce their files later (PDF rendering is slow).
 */
export async function renderMessage(project, id, { lang, data = {}, version } = {}) {
  const { tpl, version: pinned } = await templateSource(project, id, version)
  const i18n = YAML.parse(tpl.yml || '') || {}
  const langKey = resolveLang(project, langsOf(project, i18n), lang)
  const r = await compileSource(project, { mjml: tpl.mjml, i18n, links: readLinks(project), langKey })
  if (r.format !== 'email') throw httpError(400, `${id} is a PDF document, not an email (use pdf())`)
  const values = data && typeof data === 'object' ? data : {}
  let subject, html, text, names
  try {
    subject = renderJinja(r.subject, values).trim()
    html = renderJinja(r.html, values)
    text = renderJinja(r.text, values)
    names = r.attachments.map(a => renderJinja(a.filename, values))
  } catch (e) {
    throw httpError(422, `Jinja2: ${String(e.message).split('\n').pop().trim()}`)
  }
  return {
    template: tpl.id, format: r.format, locale: r.locale, lang: langKey, subject, html, text, version: pinned,
    attachments: r.attachments.map((a, i) => ({ ...a, filename: names[i] })),
    warnings: r.warnings,
    snapshot: r.attachments.length ? { mjml: tpl.mjml, yml: tpl.yml, langKey } : null,
  }
}

/** Files of a rendered message's attachments → [{ filename, content (Buffer), contentType }] */
export async function renderAttachments(project, snapshot, data = {}) {
  if (!snapshot) return []
  const out = await renderDraftAttachments(project, snapshot, { values: data })
  return out.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType }))
}

/** A PDF template rendered with data → { pdf (Buffer), engine, locale, title, version } */
export async function renderPdfDocument(project, id, { lang, data = {}, version, engine } = {}) {
  const { tpl, version: pinned } = await templateSource(project, id, version)
  const i18n = YAML.parse(tpl.yml || '') || {}
  const langKey = resolveLang(project, langsOf(project, i18n), lang)
  const r = await renderDraftPdf(project, { mjml: tpl.mjml, yml: tpl.yml, data: JSON.stringify(data ?? {}), langKey }, { engine })
  return { pdf: r.pdf, engine: r.engine, locale: r.result.locale, title: r.result.subject, version: pinned }
}
