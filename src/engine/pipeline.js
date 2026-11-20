import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import JSON5 from 'json5'
import mjml2html from 'mjml'
import { convert as htmlToText } from 'html-to-text'
import { parseFrontmatter, resolveImports, applyLayout, expandImport, wrapFragment } from './resolver.js'
import { applyParams } from '../shared/imports.js'
import { isPdf, pdfOptions, injectPrintCss, engineOptions, renderPdf } from './pdf.js'
import { validatePdf } from './verapdf.js'
import { accessibilityReport, imagesWithoutAlt } from './a11y.js'
import { resolveCommands } from './commands.js'
import { obfuscate, restore } from './guard.js'
import { annotateBody } from './design.js'
import { tryRenderJinja } from './render.js'
import { listTemplates, readLinks, readTemplate, templatePaths, toLocale, importedMessages } from './project.js'

const CONTENT_SLOT = `<mj-section css-class="tpl-slot" padding="16px 24px">
  <mj-column border="2px dashed #a5b4fc" border-radius="8px" padding="28px 0">
    <mj-text align="center" color="#6366f1" font-size="13px" font-weight="600">⧉ Contenido de la plantilla</mj-text>
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

/** Idiomas definidos en el .yml (claves de `messages`), o el idioma por defecto */
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
 * Compila una plantilla (texto fuente) para un idioma.
 * Devuelve HTML/TXT/subject con los tokens Jinja2 intactos.
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
    // (modo diseño) lectura de $import para pintar instancias de componentes seleccionables
    expandImport: (call) => {
      const r = expandImport(project.templatesDir, call, warn)
      onImport(r.file)
      return r.content
    },
  }

  // 1. Frontmatter
  const { meta, body: rawBody } = parseFrontmatter(mjml)

  // 2. (modo diseño) anotar nodos para el editor visual
  if (kind === 'component') ctx.params = meta.params
  let body = design ? annotateBody(rawBody, ctx) : rawBody
  // un componente editado/previsualizado suelto usa los valores por defecto de sus parámetros
  if (kind === 'component') body = applyParams(body, meta.params, [], warn)
  // un layout se previsualiza con un hueco en lugar de $content
  if (kind === 'layout') body = body.replace('$content', () => CONTENT_SLOT)

  // 3. $import + layout (un componente suelto se envuelve con el <mj-head> del layout de vista previa)
  const withImports = resolveImports(body, project.templatesDir, { onImport, warn })
  let unified = withImports
  if (meta.layout) {
    unified = applyLayout(withImports, meta.layout, { layoutsDir: project.layoutsDir, baseDir: project.templatesDir, onImport, warn })
  } else if (kind === 'component' && !/<mjml[\s>]/.test(withImports)) {
    unified = resolveImports(wrapFragment(withImports, project.previewLayoutFile), project.templatesDir, { onImport, warn })
  }

  // Textos de los componentes importados (por defecto; la plantilla los sobrescribe)
  ctx.messages = { ...importedMessages(imported)[langKey], ...ctx.messages }

  // 4. Comandos $ (compile-time)
  const resolved = resolveCommands(unified, ctx)

  // 5. Proteger Jinja2 del compilador MJML
  const { content: guarded, map } = obfuscate(resolved)

  // 6. MJML → HTML
  const result = await mjml2html(guarded, { validationLevel: 'soft', minify: false })
  const errors = (result.errors || []).map(e => e.formattedMessage || e.message)

  // 7. Restaurar Jinja2
  let html = restore(result.html, map)
  const subjectRaw = resolveCommands(subjectFor(i18n, langKey), ctx).trim()
  // PDF: CSS de impresión (@page) y título del documento
  const format = isPdf(meta) ? 'pdf' : 'email'
  const pdf = format === 'pdf' ? pdfOptions(meta) : null
  if (pdf) {
    pdf.engine = pdf.engine || project.config.pdf?.engine || null
    html = injectPrintCss(html, pdf, { title: subjectRaw })
  }
  // título del documento (lo leen los lectores de pantalla y se usa como título del PDF)
  if (subjectRaw && !/<title>[^<]+<\/title>/.test(html)) html = html.replace(/<title>\s*<\/title>/, `<title>${escapeHtml(subjectRaw)}</title>`)
  // (el .txt también se protege: el wordwrap no debe partir tokens Jinja2)
  const textGuard = obfuscate(html)
  const text = restore(htmlToText(textGuard.content, HTML_TO_TEXT_OPTS), textGuard.map)
  const subject = subjectRaw

  // 8. Accesibilidad (WCAG 2.1 AA)
  const a11yReport = accessibilityReport(html, { format, sourceImages: imagesWithoutAlt(resolved) })

  return { locale, langKey, html, text, subject, meta, format, pdf, warnings, errors, a11y: a11yReport.issues, a11yReport }
}

/** Compila una plantilla del proyecto y escribe los ficheros en outDir */
export async function compileTemplate(project, id, { log = console.log, samplePdf = false, validate = false } = {}) {
  const tpl = readTemplate(project, id)
  const i18n = tpl.yml ? YAML.parse(tpl.yml) || {} : {}
  const links = readLinks(project)
  const p = templatePaths(project, id)
  const outDir = path.join(project.outDir, p.id)
  fs.mkdirSync(outDir, { recursive: true })

  const files = []
  const issues = []
  for (const langKey of langsOf(project, i18n)) {
    const r = await compileSource(project, { mjml: tpl.mjml, i18n, links, langKey })
    const base = path.join(outDir, `${p.name}.${r.locale}`)
    fs.writeFileSync(`${base}.html`, r.html)
    files.push(`${base}.html`)
    if (r.format === 'pdf') {
      // opciones para el renderizador (Chromium page.pdf) del backend
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
          log?.(`    ${v.compliant ? '✓' : '✕'} ${v.profile} · ${v.passedRules} reglas ✓ · ${v.failedRules} ✕`)
          for (const rule of v.rules) issues.push({ level: 'pdfua', template: p.id, locale: r.locale, message: `${rule.id} (${rule.checks}×) ${rule.hint || rule.description}` })
        }
        files.push(`${base}.sample.pdf`)
      }
    } else {
      if (project.output.text) { fs.writeFileSync(`${base}.txt`, r.text); files.push(`${base}.txt`) }
      if (project.output.subject) { fs.writeFileSync(`${base}.subject.txt`, r.subject); files.push(`${base}.subject.txt`) }
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
 * Vista previa de un borrador (sin guardar).
 * mode: 'design' → HTML anotado para el WYSIWYG · 'preview' → renderizado con datos de demo · 'raw' → salida Jinja2
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

  return {
    ...r,
    html: tryRenderJinja(r.html, demo, warnings),
    text: tryRenderJinja(r.text, demo, warnings),
    subject: tryRenderJinja(r.subject, demo, warnings),
    warnings,
  }
}

/**
 * PDF de un borrador renderizado con sus datos de demo (vista PDF del editor, `templaitor pdf`).
 * `engine`: motor a usar (si no, el de la plantilla / config / el primero disponible).
 */
export async function renderDraftPdf(project, draft, { engine } = {}) {
  const r = await previewDraft(project, { ...draft, mode: 'preview' })
  if (r.format !== 'pdf') {
    const err = new Error('La plantilla no es PDF (añade `format: pdf` al frontmatter)')
    err.status = 400
    throw err
  }
  const out = await renderPdf(r.html, r.pdf, { staticDir: project.staticDir, engine: engine || undefined })
  return { pdf: out.pdf, engine: out.engine, result: r }
}

/** Renderiza y valida con veraPDF (PDF/UA-1) */
export async function validateDraftPdf(project, draft, opts = {}) {
  const { pdf, engine, result } = await renderDraftPdf(project, draft, opts)
  return { engine, locale: result.locale, validation: await validatePdf(pdf, { flavour: opts.flavour || 'ua1' }) }
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
