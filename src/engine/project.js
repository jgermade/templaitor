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
    linksFile: path.resolve(templatesDir, config.links ?? '_shared/links.yml'),
    staticDir: path.resolve(templatesDir, config.static ?? '_shared'),
    locales: { ...DEFAULT_LOCALES, ...(config.locales || {}) },
    defaultLocale: config.defaultLocale || Object.keys(config.locales || { en: 1 })[0],
    output: { text: true, subject: true, ...(config.output || {}) },
    smtp: config.smtp || null,
  }
  return p
}

export function toLocale(project, langKey) {
  return project.locales[langKey] || langKey
}

// ── Plantillas ────────────────────────────────────────────────

export function listTemplates(project) {
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
  walk(project.templatesDir)
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function templatePaths(project, id) {
  const safe = sanitizeId(id)
  const dir = path.join(project.templatesDir, safe)
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

export function readTemplate(project, id) {
  const p = templatePaths(project, id)
  if (!fs.existsSync(p.mjml)) throw httpError(404, `Plantilla no encontrada: ${id}`)
  return {
    id: p.id,
    name: p.name,
    mjml: fs.readFileSync(p.mjml, 'utf8'),
    yml: fs.existsSync(p.yml) ? fs.readFileSync(p.yml, 'utf8') : '',
    data: fs.existsSync(p.data) ? fs.readFileSync(p.data, 'utf8') : '{}\n',
  }
}

export function writeTemplate(project, id, { mjml, yml, data }) {
  const p = templatePaths(project, id)
  fs.mkdirSync(p.dir, { recursive: true })
  if (mjml !== undefined) fs.writeFileSync(p.mjml, mjml)
  if (yml !== undefined) fs.writeFileSync(p.yml, yml)
  if (data !== undefined) fs.writeFileSync(p.data, data)
  return readTemplate(project, id)
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
  let src = resolveImports(fs.readFileSync(file, 'utf8'), project.templatesDir)
  const links = readLinks(project)
  for (const m of src.matchAll(/\$link\{\s*([\w.-]+)/g)) src += ` ${links[m[1]] ?? ''}`
  const uniq = (re) => [...new Set([...src.matchAll(re)].map(m => m[1]))]
  return {
    vars: uniq(/\{\{-?\s*([A-Za-z_]\w*)/g),
    keys: uniq(/\$t\(\s*['"]([^'"]+)['"]/g),
  }
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

export function deleteTemplate(project, id) {
  const p = templatePaths(project, id)
  if (!fs.existsSync(p.mjml)) throw httpError(404, `Plantilla no encontrada: ${id}`)
  for (const f of [p.mjml, p.yml, p.data]) if (fs.existsSync(f)) fs.rmSync(f)
  // limpia carpetas vacías (plantilla y grupos) hasta la raíz de plantillas
  let dir = p.dir
  while (dir.startsWith(project.templatesDir + path.sep) && !fs.readdirSync(dir).length) {
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
