// templaitor project: configuration + access to template files.
//
// Layout (defaults):
//   templaitor.config.yml
//   templates/
//     _layouts/*.mjml
//     _partials/*.mjml           (optional, via $import)
//     _shared/links.yml
//     <group>/<name>/<name>.mjml   template
//                    <name>.yml    subject + messages per language
//                    <name>.json5  demo data for the preview
//   dist/                         compiled output (Jinja2)

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import JSON5 from 'json5'
import { resolveImports, resolveImportPath, parseFrontmatter, readLayoutFile, layoutFormat } from './resolver.js'
import { findImportCalls, normalizeParams } from '../shared/imports.js'

export const DEFAULT_LOCALES = {
  es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', ca: 'ca-ES', it: 'it-IT',
}

const CONFIG_FILES = ['templaitor.config.yml', 'templaitor.config.yaml', 'templaitor.config.json']

export function loadProject(cwd = process.cwd(), overrides = {}) {
  cwd = path.resolve(cwd)
  let config = {}
  let configFile = null
  for (const name of CONFIG_FILES) {
    const file = path.join(cwd, name)
    if (fs.existsSync(file)) {
      configFile = file
      config = YAML.parse(fs.readFileSync(file, 'utf8')) || {}
      break
    }
  }
  config = { ...config, ...overrides }

  const templatesDir = path.resolve(cwd, config.templates ?? 'templates')
  const p = {
    cwd,
    configFile,
    config,
    name: config.name || path.basename(cwd),
    templatesDir,
    outDir: path.resolve(cwd, config.outDir ?? 'dist'),
    layoutsDir: path.resolve(templatesDir, config.layouts ?? '_layouts'),
    partialsDir: path.resolve(templatesDir, config.partials ?? '_partials'),
    componentsDir: path.resolve(templatesDir, config.components ?? '_components'),
    linksFile: path.resolve(templatesDir, config.links ?? '_shared/links.yml'),
    staticDir: path.resolve(templatesDir, config.static ?? '_shared'),
    locales: { ...DEFAULT_LOCALES, ...(config.locales || {}) },
    defaultLocale: config.defaultLocale || Object.keys(config.locales || { en: 1 })[0],
    output: { text: true, subject: true, ...(config.output || {}) },
    smtp: config.smtp || null,
    // prefix the editor uses when inserting images from `static` (resolved at runtime)
    assetsUrl: config.assetsUrl ?? '{{ assets_url }}',
  }
  // layout whose <mj-head> is used to preview standalone components
  const layouts = listMjmlFiles(p.layoutsDir)
  const previewLayout = config.previewLayout
    ?? layouts.find(f => layoutFormat(readLayoutFile(path.join(p.layoutsDir, f)).meta) !== 'pdf') ?? layouts[0]
  p.previewLayoutFile = previewLayout ? path.resolve(p.layoutsDir, previewLayout) : null
  return p
}

/** Root directory for a document kind: templates or components */
export function baseDir(project, kind = 'template') {
  return kind === 'component' ? project.componentsDir : project.templatesDir
}

/** $import path of a component, relative to the templates root */
export function componentImportPath(project, id) {
  return `${path.relative(project.templatesDir, project.componentsDir).split(path.sep).join('/')}/${id}`
}

export function toLocale(project, langKey) {
  return project.locales[langKey] || langKey
}

// ── Templates ─────────────────────────────────────────────────

function walkDocs(root) {
  const out = []
  const walk = (dir, rel = '') => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.') || !entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      const id = rel ? `${rel}/${entry.name}` : entry.name
      if (fs.existsSync(path.join(full, `${entry.name}.mjml`))) {
        const i18n = readYaml(path.join(full, `${entry.name}.yml`))
        let format = 'email'
        try {
          const { meta } = parseFrontmatter(fs.readFileSync(path.join(full, `${entry.name}.mjml`), 'utf8'))
          if (String(meta.format || '').toLowerCase() === 'pdf') format = 'pdf'
        } catch {}
        out.push({
          id,
          name: entry.name,
          group: rel || null,
          format,
          langs: Object.keys(i18n?.messages || {}),
        })
      } else {
        walk(full, id)
      }
    }
  }
  walk(root)
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function listTemplates(project) {
  return walkDocs(project.templatesDir).map(t => ({ ...t, kind: 'template' }))
}

/** Reusable components (with where they are used and their root tag for the editor) */
export function listComponents(project) {
  const sources = [
    ...listTemplates(project).map(t => ({ ref: t.id, kind: 'template', file: templatePaths(project, t.id).mjml })),
    ...listMjmlFiles(project.layoutsDir).map(f => ({ ref: f, kind: 'layout', file: path.join(project.layoutsDir, f) })),
  ]
  const comps = walkDocs(project.componentsDir)
  for (const c of comps) sources.push({ ref: c.id, kind: 'component', file: templatePaths(project, c.id, 'component').mjml })
  const texts = sources.map(s => ({ ...s, text: fs.readFileSync(s.file, 'utf8') }))
  const importsOf = texts.map(t => ({ ...t, files: findImportCalls(t.text).map(c => resolveImportPath(project.templatesDir, c.path)) }))
  return comps.map((c) => {
    const file = templatePaths(project, c.id, 'component').mjml
    const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'))
    return {
      ...c,
      kind: 'component',
      importPath: componentImportPath(project, c.id),
      rootTag: body.match(/<(mj-[\w-]+)/)?.[1] || 'mj-section',
      params: normalizeParams(meta.params),
      usedBy: importsOf.filter(t => !(t.kind === 'component' && t.ref === c.id) && t.files.includes(file)).map(t => ({ kind: t.kind, id: t.ref })),
    }
  })
}

export function templatePaths(project, id, kind = 'template') {
  const safe = sanitizeId(id)
  const dir = path.join(baseDir(project, kind), safe)
  const name = path.basename(safe)
  return {
    id: safe,
    name,
    dir,
    mjml: path.join(dir, `${name}.mjml`),
    yml: path.join(dir, `${name}.yml`),
    data: path.join(dir, `${name}.json5`),
  }
}

export function readTemplate(project, id, kind = 'template') {
  const p = templatePaths(project, id, kind)
  if (!fs.existsSync(p.mjml)) throw httpError(404, `${kind === 'component' ? 'Component' : 'Template'} not found: ${id}`)
  return {
    kind,
    id: p.id,
    name: p.name,
    mjml: fs.readFileSync(p.mjml, 'utf8'),
    yml: fs.existsSync(p.yml) ? fs.readFileSync(p.yml, 'utf8') : '',
    data: fs.existsSync(p.data) ? fs.readFileSync(p.data, 'utf8') : '{}\n',
  }
}

export function writeTemplate(project, id, { mjml, yml, data }, kind = 'template') {
  const p = templatePaths(project, id, kind)
  fs.mkdirSync(p.dir, { recursive: true })
  if (mjml !== undefined) fs.writeFileSync(p.mjml, mjml)
  if (yml !== undefined) fs.writeFileSync(p.yml, yml)
  if (data !== undefined) fs.writeFileSync(p.data, data)
  return readTemplate(project, id, kind)
}

export function createTemplate(project, id, { layout, langs, format } = {}) {
  const p = templatePaths(project, id)
  if (fs.existsSync(p.mjml)) throw httpError(409, `Template ${p.id} already exists`)
  const langKeys = langs?.length ? langs : Object.keys(project.config.locales || { en: 1 })
  const body = [
    '<mj-section background-color="#ffffff" padding="24px">',
    '  <mj-column>',
    "    <mj-text font-size=\"20px\" font-weight=\"600\"><h1 style=\"margin:0;font:inherit;color:inherit;letter-spacing:inherit\">$t('title')</h1></mj-text>",
    "    <mj-text>$t('body')</mj-text>",
    '  </mj-column>',
    '</mj-section>',
    '',
  ].join('\n')
  const pdf = format === 'pdf'
  const fm = [
    pdf ? 'format: pdf' : '',
    layout ? `layout: ${layout}` : '',
    pdf ? 'pdf:\n  size: A4\n  orientation: portrait\n  margin: 15mm\n  footer: "{page} / {pages}"' : '',
  ].filter(Boolean).join('\n')
  const mjml = layout
    ? `---\n${fm}\n---\n\n${body}`
    : `${fm ? `---\n${fm}\n---\n\n` : ''}<mjml lang="$lang">\n  <mj-body>\n${body.split('\n').map(l => (l ? `    ${l}` : l)).join('\n')}  </mj-body>\n</mjml>\n`
  // inherits what the layout needs: Jinja2 variables and $t keys (with values from other templates)
  const { vars, keys } = layout ? layoutNeeds(project, layout) : { vars: [], keys: [] }
  const known = knownValues(project)
  const messages = Object.fromEntries(langKeys.map(l => [l, {
    title: p.name,
    body: 'Hello {{ name }}',
    ...Object.fromEntries(keys.map(k => [k, known.messages[l]?.[k] ?? known.messages['*']?.[k] ?? k])),
  }]))
  const data = { name: 'Ada', ...Object.fromEntries(vars.map(v => [v, known.data[v] ?? ''])) }
  return writeTemplate(project, id, {
    mjml,
    yml: YAML.stringify({ subject: Object.fromEntries(langKeys.map(l => [l, p.name])), messages }),
    data: `${JSON5.stringify(data, { space: 2, quote: '"' })}\n`,
  })
}

function layoutNeeds(project, layout) {
  const file = path.resolve(project.layoutsDir, layout)
  if (!fs.existsSync(file)) return { vars: [], keys: [] }
  const imported = []
  let src = resolveImports(readLayoutFile(file).body, project.templatesDir, { onImport: f => imported.push(f) })
  const provided = new Set(Object.values(importedMessages(imported)).flatMap(m => Object.keys(m)))
  const links = readLinks(project)
  for (const m of src.matchAll(/\$link\{\s*([\w.-]+)/g)) src += ` ${links[m[1]] ?? ''}`
  const uniq = (re) => [...new Set([...src.matchAll(re)].map(m => m[1]))]
  return {
    vars: uniq(/\{\{-?\s*([A-Za-z_]\w*)/g),
    keys: uniq(/\$t\(\s*['"]([^'"]+)['"]/g).filter(k => !provided.has(k)),
  }
}

/**
 * Texts provided by imported files (components with their own .yml), per
 * language. They are defaults: the template can override them.
 */
export function importedMessages(files) {
  const out = {}
  for (const file of files) {
    const i18n = readYaml(file.replace(/\.mjml$/, '.yml'))
    for (const [lang, msgs] of Object.entries(i18n?.messages || {})) out[lang] = { ...out[lang], ...msgs }
  }
  return out
}

export function createComponent(project, id, { mjml, messages, data } = {}) {
  const p = templatePaths(project, id, 'component')
  if (fs.existsSync(p.mjml)) throw httpError(409, `Component ${p.id} already exists`)
  const langKeys = Object.keys(project.config.locales || { en: 1 })
  const body = mjml ?? [
    '<mj-section padding="16px 24px">',
    '  <mj-column>',
    "    <mj-text>$t('text')</mj-text>",
    '  </mj-column>',
    '</mj-section>',
    '',
  ].join('\n')
  const msgs = messages ?? Object.fromEntries(langKeys.map(l => [l, { text: p.name }]))
  return writeTemplate(project, id, {
    mjml: body,
    yml: YAML.stringify({ messages: msgs }),
    data: `${JSON5.stringify(data ?? {}, { space: 2, quote: '"' })}\n`,
  }, 'component')
}

/** Values already used by other templates (demo data and messages), to reuse them */
function knownValues(project) {
  const data = {}
  const messages = {}
  for (const t of listTemplates(project)) {
    const tp = templatePaths(project, t.id)
    try { Object.assign(data, { ...JSON5.parse(fs.readFileSync(tp.data, 'utf8')), ...data }) } catch {}
    const i18n = readYaml(tp.yml)
    for (const [l, msgs] of Object.entries(i18n?.messages || {})) {
      messages[l] = { ...msgs, ...messages[l] }
      messages['*'] = { ...msgs, ...messages['*'] }
    }
  }
  return { data, messages }
}

// ── Layouts ───────────────────────────────────────────────────

const LAYOUT_ID = /^[\w.-]+\.mjml$/

function layoutFile(project, id) {
  if (!LAYOUT_ID.test(String(id || ''))) throw httpError(400, `Invalid layout: ${id}`)
  return path.join(project.layoutsDir, id)
}

/** Layouts with the templates that use them (frontmatter `layout:`) */
export function listLayouts(project) {
  const templates = listTemplates(project).map((t) => {
    const { meta } = parseFrontmatter(fs.readFileSync(templatePaths(project, t.id).mjml, 'utf8'))
    return { id: t.id, layout: meta.layout }
  })
  return listMjmlFiles(project.layoutsDir).map(file => ({
    kind: 'layout',
    id: file,
    name: file.replace(/\.mjml$/, ''),
    format: layoutFormat(readLayoutFile(path.join(project.layoutsDir, file)).meta), // email · pdf · null
    usedBy: templates.filter(t => t.layout === file).map(t => ({ kind: 'template', id: t.id })),
  }))
}

/**
 * Layout document for the editor. A layout has no texts or data of its own, so
 * the preview uses those of the first template using it (they are not saved).
 */
export function readLayout(project, id) {
  const file = layoutFile(project, id)
  if (!fs.existsSync(file)) throw httpError(404, `Layout not found: ${id}`)
  const from = listLayouts(project).find(l => l.id === id)?.usedBy[0]?.id ?? null
  const tpl = from ? readTemplate(project, from) : null
  return {
    kind: 'layout',
    id,
    name: id.replace(/\.mjml$/, ''),
    mjml: fs.readFileSync(file, 'utf8'),
    yml: tpl?.yml ?? '',
    data: tpl?.data ?? `${JSON5.stringify(knownValues(project).data, { space: 2, quote: '"' })}\n`,
    previewFrom: from,
  }
}

export function writeLayout(project, id, { mjml }) {
  const file = layoutFile(project, id)
  if (!mjml?.includes('$content')) throw httpError(400, 'The layout must contain $content (where each template goes)')
  fs.writeFileSync(file, mjml)
  return readLayout(project, id)
}

export function createLayout(project, id, { format = 'email' } = {}) {
  const name = String(id || '').trim().replace(/\.mjml$/, '')
  const file = layoutFile(project, `${name}.mjml`)
  if (fs.existsSync(file)) throw httpError(409, `Layout ${name}.mjml already exists`)
  fs.mkdirSync(project.layoutsDir, { recursive: true })
  const pdf = format === 'pdf'
  fs.writeFileSync(file, [
    '---',
    `format: ${pdf ? 'pdf' : 'email'}   # the templates it is offered to (email · pdf)`,
    '---',
    '',
    '<mjml lang="$lang">',
    '  <mj-head>',
    '    <mj-attributes>',
    '      <mj-all font-family="Helvetica, Arial, sans-serif" />',
    '      <mj-text font-size="14px" line-height="1.6" color="#333333" />',
    '    </mj-attributes>',
    '  </mj-head>',
    `  <mj-body background-color="${pdf ? '#ffffff' : '#f4f4f5'}">`,
    '    $content',
    '  </mj-body>',
    '</mjml>',
    '',
  ].join('\n'))
  return readLayout(project, `${name}.mjml`)
}

export function deleteLayout(project, id) {
  const file = layoutFile(project, id)
  const used = listLayouts(project).find(l => l.id === id)?.usedBy || []
  if (used.length) throw httpError(409, `The layout is used by: ${used.map(u => u.id).join(', ')}`)
  if (!fs.existsSync(file)) throw httpError(404, `Layout not found: ${id}`)
  fs.rmSync(file)
}

// ── Images (static directory) ─────────────────────────────

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i

export function listAssets(project) {
  const out = []
  const walk = (dir, rel = '') => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else if (IMAGE_EXT.test(e.name)) out.push({ path: r, size: fs.statSync(path.join(dir, e.name)).size })
    }
  }
  walk(project.staticDir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function saveAsset(project, name, buffer) {
  const clean = String(name || '').toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!clean || !IMAGE_EXT.test(clean)) throw httpError(400, 'Only png, jpg, gif, webp or svg images are allowed')
  if (buffer.length > 5 * 1024 * 1024) throw httpError(413, 'The image is larger than 5 MB')
  fs.mkdirSync(project.staticDir, { recursive: true })
  let file = clean
  const ext = path.extname(clean)
  for (let i = 2; fs.existsSync(path.join(project.staticDir, file)); i++) file = `${path.basename(clean, ext)}-${i}${ext}`
  fs.writeFileSync(path.join(project.staticDir, file), buffer)
  return { path: file, size: buffer.length }
}

export function readLinks(project) {
  return readYaml(project.linksFile) || {}
}

export function deleteTemplate(project, id, kind = 'template') {
  const p = templatePaths(project, id, kind)
  if (!fs.existsSync(p.mjml)) throw httpError(404, `Template not found: ${id}`)
  for (const f of [p.mjml, p.yml, p.data]) if (fs.existsSync(f)) fs.rmSync(f)
  // removes empty folders (template and groups) up to the templates root
  let dir = p.dir
  const root = baseDir(project, kind)
  while (dir.startsWith(root + path.sep) && !fs.readdirSync(dir).length) {
    fs.rmdirSync(dir)
    dir = path.dirname(dir)
  }
}

// ── Layouts / partials / links ───────────────────────────────

export function listMjmlFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.mjml')).sort()
}

export function readYaml(file) {
  if (!file || !fs.existsSync(file)) return null
  return YAML.parse(fs.readFileSync(file, 'utf8'))
}

/** Read/write auxiliary files (layouts, partials, links) inside the templates directory */
export function resolveAuxFile(project, rel) {
  const full = path.resolve(project.templatesDir, rel)
  if (!full.startsWith(project.templatesDir + path.sep)) throw httpError(400, 'Path not allowed')
  if (!/\.(mjml|ya?ml|json5?)$/.test(full)) throw httpError(400, 'File type not allowed')
  return full
}

function sanitizeId(id) {
  const clean = String(id || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!clean || clean.split('/').some(s => !s || s === '..' || s === '.' || s.startsWith('_') || !/^[\w.-]+$/.test(s))) {
    throw httpError(400, `Invalid template id: ${id}`)
  }
  return clean
}

export function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}
