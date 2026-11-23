import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import JSON5 from 'json5'
import mjml2html from 'mjml'
import { convert as htmlToText } from 'html-to-text'
import { parseFrontmatter, resolveImports, applyLayout, expandImport, wrapFragment, readLayoutFile, layoutFormat } from './resolver.js'
import { applyParams } from '../shared/imports.js'
import { isPdf, pdfOptions, injectPrintCss, engineOptions, renderPdf } from './pdf.js'
import { validatePdf } from './verapdf.js'
import { accessibilityReport, imagesWithoutAlt } from './a11y.js'
import { resolveCommands } from './commands.js'
import { obfuscate, restore } from './guard.js'
import { annotateBody } from './design.js'
import { tryRenderJinja, renderJinja } from './render.js'
import { normalizeContract, usedVariables, validateData, formatErrors, toJsonSchema } from '../shared/contract.js'
import { normalizeAttachments } from '../shared/attachments.js'
import { resolveAttachments, renderAttachment } from './attachments.js'
import { listTemplates, readLinks, readTemplate, templatePaths, toLocale, importedMessages } from './project.js'

const CONTENT_SLOT = `<mj-section css-class="tpl-slot" padding="16px 24px">
  <mj-column border="2px dashed #a5b4fc" border-radius="8px" padding="28px 0">
    <mj-text align="center" color="#6366f1" font-size="13px" font-weight="600">⧉ Template content</mj-text>
  </mj-column>
</mj-section>`

const HTML_TO_TEXT_OPTS = {
  wordwrap: 80,
  selectors: [
    { selector: 'img', format: 'skip' },
    { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    { selector: 'head', format: 'skip' },
  ],
}

/** Languages defined in the .yml (keys of `messages`), or the default language */
export function langsOf(project, i18n) {
  const keys = Object.keys(i18n?.messages || {})
  return keys.length ? keys : [project.defaultLocale]
}

export function subjectFor(i18n, langKey) {
  const s = i18n?.subject
  if (!s) return ''
  if (typeof s === 'string') return s
  return s[langKey] ?? ''
}

/**
 * Compiles a template (source text) for one language.
 * Returns HTML/TXT/subject with Jinja2 tokens intact.
 */
export async function compileSource(project, { mjml, i18n = {}, links = {}, langKey, design = false, kind = 'template' }) {
  const locale = toLocale(project, langKey)
  const country = locale.split('-')[1] || String(langKey).toUpperCase()
  const warnings = []
  const imported = []
  const onImport = (file) => imported.push(file)
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m) }
  const ctx = {
    lang: locale, country, langKey, kind, messages: i18n.messages?.[langKey] || {}, links, warnings,
    // (design mode) reads $import calls to draw selectable component instances
    expandImport: (call) => {
      const r = expandImport(project.templatesDir, call, warn)
      onImport(r.file)
      return r.content
    },
  }

  // 1. Frontmatter
  const { meta, body: rawBody } = parseFrontmatter(mjml)

  // 2. (design mode) annotate nodes for the visual editor
  if (kind === 'component') ctx.params = meta.params
  let body = design ? annotateBody(rawBody, ctx) : rawBody
  // a component edited/previewed on its own uses the default values of its parameters
  if (kind === 'component') body = applyParams(body, meta.params, [], warn)
  // a layout is previewed with a slot instead of $content
  if (kind === 'layout') body = body.replace('$content', () => CONTENT_SLOT)

  // 3. $import + layout (a standalone component is wrapped with the <mj-head> of the preview layout)
  const withImports = resolveImports(body, project.templatesDir, { onImport, warn })
  let unified = withImports
  if (meta.layout) {
    const lf = fs.existsSync(path.join(project.layoutsDir, meta.layout)) ? layoutFormat(readLayoutFile(path.join(project.layoutsDir, meta.layout)).meta) : null
    const tf = isPdf(meta) ? 'pdf' : 'email'
    if (lf && kind === 'template' && lf !== tf) warn(`${meta.layout} is a ${lf === 'pdf' ? 'PDF' : 'email'} layout, but this template is ${tf === 'pdf' ? 'a PDF document' : 'an email'}`)
    unified = applyLayout(withImports, meta.layout, { layoutsDir: project.layoutsDir, baseDir: project.templatesDir, onImport, warn })
  } else if (kind === 'component' && !/<mjml[\s>]/.test(withImports)) {
    unified = resolveImports(wrapFragment(withImports, project.previewLayoutFile), project.templatesDir, { onImport, warn })
  }

  // Texts of the imported components (defaults; the template overrides them)
  ctx.messages = { ...importedMessages(imported)[langKey], ...ctx.messages }

  // 4. $ commands (compile time)
  const resolved = resolveCommands(unified, ctx)
  // (design mode: the body is annotated — variables are chips — so the data the template uses is read from
  // the plain source, resolved the same way)
  let plainSource = null
  if (design && kind === 'template') {
    const quiet = { onImport: () => {}, warn: () => {} }
    const imp = resolveImports(rawBody, project.templatesDir, quiet)
    const uni = meta.layout ? applyLayout(imp, meta.layout, { layoutsDir: project.layoutsDir, baseDir: project.templatesDir, ...quiet }) : imp
    plainSource = resolveCommands(uni, { ...ctx, warnings: [] })
  }

  // 5. Protect Jinja2 from the MJML compiler
  const { content: guarded, map } = obfuscate(resolved)

  // 6. MJML → HTML
  const result = await mjml2html(guarded, { validationLevel: 'soft', minify: false })
  const errors = (result.errors || []).map(e => e.formattedMessage || e.message)

  // 7. Restore Jinja2
  let html = restore(result.html, map)
  const subjectRaw = resolveCommands(subjectFor(i18n, langKey), ctx).trim()
  // PDF: print CSS (@page) and document title
  const format = isPdf(meta) ? 'pdf' : 'email'
  const pdf = format === 'pdf' ? pdfOptions(meta) : null
  if (pdf) {
    pdf.engine = pdf.engine || project.config.pdf?.engine || null
    html = injectPrintCss(html, pdf, { title: subjectRaw })
  }
  // document title (read by screen readers and used as the PDF title)
  if (subjectRaw && !/<title>[^<]+<\/title>/.test(html)) html = html.replace(/<title>\s*<\/title>/, `<title>${escapeHtml(subjectRaw)}</title>`)
  // (the .txt is protected too: word-wrap must not split Jinja2 tokens)
  const textGuard = obfuscate(html)
  const text = restore(htmlToText(textGuard.content, HTML_TO_TEXT_OPTS), textGuard.map)
  const subject = subjectRaw

  // 8. Accessibility (WCAG 2.1 AA)
  const a11yReport = accessibilityReport(html, { format, sourceImages: imagesWithoutAlt(resolved) })

  // 9. Attachments (emails): local PDF templates in this language and remote files
  const attachments = format === 'email' && kind === 'template' ? resolveAttachments(project, meta, ctx) : []

  // 10. Data contract (`data:` in the frontmatter): what the template uses vs what it declares
  const hasContract = kind === 'template' && meta.data != null
  const contract = hasContract ? normalizeContract(meta.data) : {}
  const usedVars = usedVariables([...(plainSource != null ? [plainSource] : [html, text]), subject, ...attachments.flatMap(a => [a.filename, a.url ?? ''])].join('\n'))
  for (const a of normalizeAttachments(meta.attachments)) if (a.context && !usedVars.includes(String(a.context).split('.')[0])) usedVars.push(String(a.context).split('.')[0])
  if (hasContract) {
    for (const v of usedVars) if (!contract[v]) warn(`{{ ${v} }} is used but not declared in the data contract (data: in the frontmatter)`)
    for (const k of Object.keys(contract)) if (!usedVars.includes(k)) warn(`${k} is declared in the data contract but not used`)
  }

  return { locale, langKey, html, text, subject, meta, format, pdf, attachments, warnings, errors, a11y: a11yReport.issues, a11yReport, hasContract, contract, usedVars }
}

/** Compiles a project template and writes the files to outDir */
export async function compileTemplate(project, id, { log = console.log, samplePdf = false, validate = false } = {}) {
  const tpl = readTemplate(project, id)
  const i18n = tpl.yml ? YAML.parse(tpl.yml) || {} : {}
  const links = readLinks(project)
  const p = templatePaths(project, id)
  const outDir = path.join(project.outDir, p.id)
  fs.mkdirSync(outDir, { recursive: true })

  const files = []
  const issues = []
  // data contract → JSON Schema for the backend (one per template)
  const { meta: fm } = parseFrontmatter(tpl.mjml)
  if (fm.data != null) {
    const file = path.join(outDir, `${p.name}.schema.json`)
    fs.writeFileSync(file, `${JSON.stringify(toJsonSchema(normalizeContract(fm.data), { id: `${p.id}.schema.json`, title: p.id }), null, 2)}\n`)
    files.push(file)
  }
  for (const langKey of langsOf(project, i18n)) {
    const r = await compileSource(project, { mjml: tpl.mjml, i18n, links, langKey })
    const base = path.join(outDir, `${p.name}.${r.locale}`)
    fs.writeFileSync(`${base}.html`, r.html)
    files.push(`${base}.html`)
    if (r.format === 'pdf') {
      // options for the backend renderer
      fs.writeFileSync(`${base}.pdf.json`, `${JSON.stringify({
        title: r.subject,
        engine: r.pdf.engine || 'auto',
        recommended: 'weasyprint',
        page: { size: r.pdf.size, landscape: r.pdf.landscape, margin: r.pdf.margin },
        engines: engineOptions(r.pdf),
      }, null, 2)}\n`)
      files.push(`${base}.pdf.json`)
      if (samplePdf) {
        const demo = fs.existsSync(p.data) ? JSON5.parse(fs.readFileSync(p.data, 'utf8')) : {}
        const { pdf: sample, engine } = await renderPdf(tryRenderJinja(r.html, demo, []), r.pdf, { staticDir: project.staticDir })
        fs.writeFileSync(`${base}.sample.pdf`, sample)
        log?.(`  ✓ ${p.name}.${r.locale}.sample.pdf (${engine})`)
        if (validate) {
          const v = await validatePdf(sample)
          log?.(`    ${v.compliant ? '✓' : '✕'} ${v.profile} · ${v.passedRules} rules ✓ · ${v.failedRules} ✕`)
          for (const rule of v.rules) issues.push({ level: 'pdfua', template: p.id, locale: r.locale, message: `${rule.id} (${rule.checks}×) ${rule.hint || rule.description}` })
        }
        files.push(`${base}.sample.pdf`)
      }
    } else {
      if (project.output.text) { fs.writeFileSync(`${base}.txt`, r.text); files.push(`${base}.txt`) }
      if (project.output.subject) { fs.writeFileSync(`${base}.subject.txt`, r.subject); files.push(`${base}.subject.txt`) }
      if (r.attachments.length) {
        // for the backend: what to attach (local documents point to their compiled files)
        fs.writeFileSync(`${base}.attachments.json`, `${JSON.stringify(r.attachments.map(({ index, ...a }) => a), null, 2)}\n`)
        files.push(`${base}.attachments.json`)
      }
    }
    for (const w of r.warnings) issues.push({ level: 'warn', template: p.id, locale: r.locale, message: w })
    for (const e of r.errors) issues.push({ level: 'mjml', template: p.id, locale: r.locale, message: e })
    for (const a of r.a11y) issues.push({ level: `a11y-${a.level}`, template: p.id, locale: r.locale, message: `WCAG ${a.wcag}: ${a.message}` })
    log?.(`  ✓ ${p.name}.${r.locale}`)
  }
  return { files, issues }
}

export async function compileProject(project, { target, log = console.log, samplePdf = false, validate = false } = {}) {
  const ids = target ? [target] : listTemplates(project).map(t => t.id)
  const all = { files: [], issues: [] }
  for (const id of ids) {
    log?.(`\n→ ${id}`)
    const r = await compileTemplate(project, id, { log, samplePdf, validate })
    all.files.push(...r.files)
    all.issues.push(...r.issues)
    for (const i of r.issues) log?.(`  [${i.level}] ${i.locale}: ${i.message}`)
  }
  return all
}

/**
 * Preview of a draft (unsaved).
 * mode: 'design' → annotated HTML for the WYSIWYG · 'preview' → rendered with demo data · 'raw' → Jinja2 output
 */
export async function previewDraft(project, { mjml, yml = '', data = '{}', langKey, mode = 'preview', kind = 'template' }) {
  const warnings = []
  let i18n = {}
  try { i18n = YAML.parse(yml) || {} } catch (e) { warnings.push(`YAML: ${e.message.split('\n')[0]}`) }
  let demo = {}
  try { demo = JSON5.parse(data || '{}') } catch (e) { warnings.push(`JSON5: ${e.message}`) }

  const lang = langKey || langsOf(project, i18n)[0]
  const r = await compileSource(project, { mjml, i18n, links: readLinks(project), langKey: lang, design: mode === 'design', kind })
  warnings.push(...r.warnings)

  if (mode === 'raw') return { ...r, warnings }
  // the demo data is an example of the contract: it has to fulfil it
  if (r.hasContract) for (const e of formatErrors(validateData(r.contract, demo))) warnings.push(`Demo data: ${e}`)

  return {
    ...r,
    html: tryRenderJinja(r.html, demo, warnings),
    text: tryRenderJinja(r.text, demo, warnings),
    subject: tryRenderJinja(r.subject, demo, warnings),
    attachments: r.attachments.map(a => ({
      ...a,
      filename: tryRenderJinja(a.filename, demo, warnings),
      ...(a.url ? { url: tryRenderJinja(a.url, demo, warnings) } : {}),
    })),
    warnings,
  }
}

/** PDF of a project template rendered in one language with the given data */
export async function renderTemplatePdf(project, id, langKey, data, { engine } = {}) {
  const tpl = readTemplate(project, id)
  const i18n = tpl.yml ? YAML.parse(tpl.yml) || {} : {}
  const r = await compileSource(project, { mjml: tpl.mjml, i18n, links: readLinks(project), langKey })
  if (r.format !== 'pdf') {
    const err = new Error(`${id} is not a PDF document (add \`format: pdf\` to its frontmatter)`)
    err.status = 400
    throw err
  }
  const out = await renderPdf(renderJinja(r.html, data), r.pdf, { staticDir: project.staticDir, engine: engine || undefined })
  return out.pdf
}

/**
 * Attachments of a draft rendered with its demo data (or `data`):
 * [{ filename, content, contentType }]. `index` renders only that attachment.
 */
export async function renderDraftAttachments(project, { mjml, yml = '', data = '{}', langKey }, { index, values } = {}) {
  const i18n = YAML.parse(yml || '') || {}
  const demo = values ?? JSON5.parse(data || '{}')
  const lang = langKey || langsOf(project, i18n)[0]
  const r = await compileSource(project, { mjml, i18n, links: readLinks(project), langKey: lang })
  const list = index == null ? r.attachments : r.attachments.filter(a => a.index === Number(index))
  if (index != null && !list.length) {
    const err = new Error(`Attachment ${Number(index) + 1} not found${r.warnings.length ? `: ${r.warnings.join(' · ')}` : ''}`)
    err.status = 404
    throw err
  }
  // (hosted service: project.fetchImpl blocks private networks for remote attachments)
  // `values` = real data (a send): no demo data; otherwise an editor preview with the draft's demo data
  const opts = { render: renderJinja, renderDocument: (id, l, d) => renderTemplatePdf(project, id, l, d), fetchImpl: project.fetchImpl ?? fetch, preview: values == null }
  const out = []
  for (const att of list) out.push(await renderAttachment(project, att, demo, opts))
  return out
}

/**
 * PDF of a draft rendered with its demo data (editor PDF view, `templaitor pdf`).
 * `engine`: engine to use (otherwise the template's / config's / the first available).
 */
export async function renderDraftPdf(project, draft, { engine } = {}) {
  const r = await previewDraft(project, { ...draft, mode: 'preview' })
  if (r.format !== 'pdf') {
    const err = new Error('The template is not a PDF document (add `format: pdf` to its frontmatter)')
    err.status = 400
    throw err
  }
  const out = await renderPdf(r.html, r.pdf, { staticDir: project.staticDir, engine: engine || undefined })
  return { pdf: out.pdf, engine: out.engine, result: r }
}

/** Renders and validates with veraPDF (PDF/UA-1) */
export async function validateDraftPdf(project, draft, opts = {}) {
  const { pdf, engine, result } = await renderDraftPdf(project, draft, opts)
  return { engine, locale: result.locale, validation: await validatePdf(pdf, { flavour: opts.flavour || 'ua1' }) }
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
