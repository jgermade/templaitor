// templaitor as a library: the engine another project embeds to render its emails and PDFs.
//
//   import { createEngine } from 'templaitor'
//   const engine = createEngine()                       // the templates shipped in this package
//   const engine = createEngine({ cwd: './emails' })    // or a project of your own (templaitor.config.yml)
//
//   const msg = await engine.render('orders/order-confirmation', { lang: 'es', data, version: 'v3' })
//   // → { subject, html, text, locale, version, attachments: [{ filename, … }] }
//   const files = await engine.attachments(msg)          // → [{ filename, content: Buffer, contentType }]
//   const { pdf } = await engine.pdf('documents/invoice', { lang: 'en', data })
//
// Everything runs in-process (no server). Lower-level building blocks are exported below.
import path from 'node:path'
import YAML from 'yaml'
import { fileURLToPath } from 'node:url'
import { loadProject, listTemplates, listComponents, listLayouts, readTemplate, readLinks } from './engine/project.js'
import { compileProject, compileSource, previewDraft, langsOf } from './engine/pipeline.js'
import { renderMessage, renderAttachments, renderPdfDocument, resolveLang, templateSchema } from './engine/message.js'
import { listVersions, readVersion, resolveVersion } from './engine/versions.js'
import { renderJinja } from './engine/render.js'
import { projectTypes } from './engine/types.js'

/** Folder of the templaitor project shipped with this package (the repository's own templates) */
export const BUNDLED_PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Engine for one templaitor project.
 *   cwd:       project folder (default: the templates shipped in this package)
 *   overrides: configuration values that replace those of templaitor.config.yml (e.g. { outDir })
 *   fetch:     fetch used for remote attachments (default: global fetch)
 */
export function createEngine({ cwd = BUNDLED_PROJECT, overrides = {}, fetch: fetchImpl } = {}) {
  const project = loadProject(cwd, overrides)
  if (fetchImpl) project.fetchImpl = fetchImpl

  return {
    project,

    /** Templates of the project → [{ id, format: 'email' | 'pdf', langs }] */
    templates: () => listTemplates(project).map(t => ({ id: t.id, format: t.format, langs: t.langs })),
    components: () => listComponents(project).map(c => ({ id: c.id, params: c.params })),
    layouts: () => listLayouts(project).map(l => ({ id: l.id })),

    /**
     * An email for one recipient → { template, subject, html, text, locale, lang, version, attachments, warnings }
     *   lang: key (`es`), locale (`es-ES`) or a locale's language; default: the template's first language
     *   version: 3 · 'v3' · 'latest' · a revision (git) — the template as it was at that version
     *   validate: false skips the data contract check (otherwise a 422 error lists what does not match)
     */
    async render(id, { lang, data = {}, version, validate = true } = {}) {
      const r = await renderMessage(project, id, { lang, data, version, validate })
      const { snapshot, ...msg } = r
      Object.defineProperty(msg, '_attachments', { value: { snapshot, data }, enumerable: false })
      return msg
    },

    /** Files of a rendered email's attachments (local PDF templates in its language, remote downloads) */
    attachments: (msg) => renderAttachments(project, msg?._attachments?.snapshot, msg?._attachments?.data),

    /** A PDF template rendered with data → { pdf: Buffer, engine, locale, title, version } */
    pdf: (id, { lang, data = {}, version, engine, validate = true } = {}) => renderPdfDocument(project, id, { lang, data, version, engine, validate }),

    /** TypeScript declarations of every template's data (`TemplateData`: id → data) */
    types: () => projectTypes(project),

    /** JSON Schema of the template's data contract (`data:` in its frontmatter), or null */
    schema: (id, { version } = {}) => templateSchema(project, id, { version }),

    /** The Jinja2 output of a template in one language, without data (for a Jinja2 backend) */
    async compile(id, { lang } = {}) {
      const tpl = readTemplate(project, id)
      const i18n = YAML.parse(tpl.yml || '') || {}
      const langKey = resolveLang(project, langsOf(project, i18n), lang)
      const r = await compileSource(project, { mjml: tpl.mjml, i18n, langKey, links: readLinks(project) })
      return { format: r.format, locale: r.locale, subject: r.subject, html: r.html, text: r.text, attachments: r.attachments, warnings: r.warnings }
    },

    /** Writes the compiled output of every template (or one) to `outDir` → { files, issues } */
    build: ({ id, log = null } = {}) => compileProject(project, { target: id, log }),

    /** Versions of a template (git history, or the snapshot shipped with a deployment) */
    versions: async (id, { kind = 'template', limit } = {}) => (await listVersions(project, id, kind, { limit })).versions,
    version: (id, rev, { kind = 'template' } = {}) => readVersion(project, id, kind, rev),
  }
}

// building blocks
export {
  loadProject, listTemplates, listComponents, listLayouts, readTemplate,
  compileProject, compileSource, previewDraft, renderJinja,
  renderMessage, renderAttachments, renderPdfDocument,
  listVersions, readVersion, resolveVersion,
}
export { createHandler } from './server/server.js'
