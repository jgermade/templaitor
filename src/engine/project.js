// Proyecto templaitor: configuración + acceso a ficheros de plantillas.
//
// Estructura (por defecto):
//   templaitor.config.yml
//   templates/
//     _layouts/*.mjml
//     _partials/*.mjml           (opcional, vía $import)
//     _shared/links.yml
//     <grupo>/<nombre>/<nombre>.mjml   plantilla
//                      <nombre>.yml    subject + messages por idioma
//                      <nombre>.json5  datos de demo para la vista previa
//   dist/                         salida compilada (Jinja2)

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import JSON5 from 'json5'
import { resolveImports } from './resolver.js'

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
  }
  // layout cuyo <mj-head> se usa para previsualizar componentes sueltos
  const layouts = listMjmlFiles(p.layoutsDir)
  const previewLayout = config.previewLayout ?? layouts[0]
  p.previewLayoutFile = previewLayout ? path.resolve(p.layoutsDir, previewLayout) : null
  return p
}

/** Directorio raíz según el tipo de documento: plantillas o componentes */
export function baseDir(project, kind = 'template') {
  return kind === 'component' ? project.componentsDir : project.templatesDir
}

/** Ruta para $import de un componente, relativa a la raíz de plantillas */
export function componentImportPath(project, id) {
  return `${path.relative(project.templatesDir, project.componentsDir).split(path.sep).join('/')}/${id}`
}

export function toLocale(project, langKey) {
  return project.locales[langKey] || langKey
}

// ── Plantillas ────────────────────────────────────────────────

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
        out.push({
          id,
          name: entry.name,
          group: rel || null,
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

/** Componentes reutilizables (con dónde se usan y su etiqueta raíz para el editor) */
export function listComponents(project) {
  const sources = [
    ...listTemplates(project).map(t => ({ ref: t.id, kind: 'template', file: templatePaths(project, t.id).mjml })),
    ...listMjmlFiles(project.layoutsDir).map(f => ({ ref: f, kind: 'layout', file: path.join(project.layoutsDir, f) })),
  ]
  const comps = walkDocs(project.componentsDir)
  for (const c of comps) sources.push({ ref: c.id, kind: 'component', file: templatePaths(project, c.id, 'component').mjml })
  const texts = sources.map(s => ({ ...s, text: fs.readFileSync(s.file, 'utf8') }))
  return comps.map((c) => {
    const importPath = componentImportPath(project, c.id)
    const re = new RegExp(`\\$import\\(\\s*['"]?${escapeRe(importPath)}(?:/${escapeRe(c.name)}\\.mjml|\\.mjml)?['"]?\\s*\\)`)
    const src = fs.readFileSync(templatePaths(project, c.id, 'component').mjml, 'utf8')
    return {
      ...c,
      kind: 'component',
      importPath,
      rootTag: src.match(/<(mj-[\w-]+)/)?.[1] || 'mj-section',
      usedBy: texts.filter(t => !(t.kind === 'component' && t.ref === c.id) && re.test(t.text)).map(t => ({ kind: t.kind, id: t.ref })),
    }
  })
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
  if (!fs.existsSync(p.mjml)) throw httpError(404, `${kind === 'component' ? 'Componente' : 'Plantilla'} no encontrado: ${id}`)
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

export function createTemplate(project, id, { layout, langs } = {}) {
  const p = templatePaths(project, id)
  if (fs.existsSync(p.mjml)) throw httpError(409, `Ya existe la plantilla ${p.id}`)
  const langKeys = langs?.length ? langs : Object.keys(project.config.locales || { en: 1 })
  const body = [
    '<mj-section background-color="#ffffff" padding="24px">',
    '  <mj-column>',
    "    <mj-text font-size=\"20px\" font-weight=\"600\">$t('title')</mj-text>",
    "    <mj-text>$t('body')</mj-text>",
    '  </mj-column>',
    '</mj-section>',
    '',
  ].join('\n')
  const mjml = layout
    ? `---\nlayout: ${layout}\n---\n\n${body}`
    : `<mjml>\n  <mj-body>\n${body.split('\n').map(l => (l ? `    ${l}` : l)).join('\n')}  </mj-body>\n</mjml>\n`
  // hereda lo que necesita el layout: variables Jinja2 y claves $t (con valores de otras plantillas)
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
  let src = resolveImports(fs.readFileSync(file, 'utf8'), project.templatesDir, { onImport: f => imported.push(f) })
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
 * Textos que aportan los ficheros importados (componentes con su propio .yml),
 * por idioma. Sirven de valores por defecto: la plantilla puede sobrescribirlos.
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
  if (fs.existsSync(p.mjml)) throw httpError(409, `Ya existe el componente ${p.id}`)
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

/** Valores ya usados en otras plantillas (datos de demo y mensajes) para reutilizarlos */
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

export function readLinks(project) {
  return readYaml(project.linksFile) || {}
}

export function deleteTemplate(project, id, kind = 'template') {
  const p = templatePaths(project, id, kind)
  if (!fs.existsSync(p.mjml)) throw httpError(404, `Plantilla no encontrada: ${id}`)
  for (const f of [p.mjml, p.yml, p.data]) if (fs.existsSync(f)) fs.rmSync(f)
  // limpia carpetas vacías (plantilla y grupos) hasta la raíz de plantillas
  let dir = p.dir
  const root = baseDir(project, kind)
  while (dir.startsWith(root + path.sep) && !fs.readdirSync(dir).length) {
    fs.rmdirSync(dir)
    dir = path.dirname(dir)
  }
}

// ── Layouts / parciales / links ───────────────────────────────

export function listMjmlFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.mjml')).sort()
}

export function readYaml(file) {
  if (!file || !fs.existsSync(file)) return null
  return YAML.parse(fs.readFileSync(file, 'utf8'))
}

/** Lectura/escritura de ficheros auxiliares (layouts, parciales, links) dentro del directorio de plantillas */
export function resolveAuxFile(project, rel) {
  const full = path.resolve(project.templatesDir, rel)
  if (!full.startsWith(project.templatesDir + path.sep)) throw httpError(400, 'Ruta no permitida')
  if (!/\.(mjml|ya?ml|json5?)$/.test(full)) throw httpError(400, 'Tipo de fichero no permitido')
  return full
}

function sanitizeId(id) {
  const clean = String(id || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!clean || clean.split('/').some(s => !s || s === '..' || s === '.' || s.startsWith('_') || !/^[\w.-]+$/.test(s))) {
    throw httpError(400, `Id de plantilla no válido: ${id}`)
  }
  return clean
}

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}
