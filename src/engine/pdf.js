// Plantillas PDF: opciones de página, HTML de impresión y motores de render.
//
// Una plantilla es PDF si su frontmatter tiene `format: pdf`:
//
//   ---
//   format: pdf
//   layout: document.layout.mjml
//   pdf:
//     engine: weasyprint    # opcional: weasyprint · prince · chromium · auto
//     size: A4              # A4 · A5 · A3 · Letter · Legal
//     orientation: portrait # portrait · landscape
//     margin: 15mm          # o { top, right, bottom, left }
//     header: ""            # texto de cabecera ({page}, {pages}, {title})
//     footer: "{page} / {pages}"
//   ---
//
// El HTML compilado es el mismo para todos los motores: usa CSS de paginación
// estándar (@page con cajas de margen para cabecera/pie), que entienden
// WeasyPrint, Prince y Chromium ≥ 131. La compilación sigue produciendo HTML con
// Jinja2; el PDF se genera a partir del HTML ya renderizado con datos.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const PAGE_SIZES = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] }

export function isPdf(meta) {
  return String(meta?.format || '').toLowerCase() === 'pdf'
}

/** Normaliza `pdf:` del frontmatter */
export function pdfOptions(meta = {}) {
  const o = meta.pdf || {}
  const size = PAGE_SIZES[o.size] ? o.size : 'A4'
  const m = typeof o.margin === 'object' && o.margin ? o.margin : { top: o.margin, right: o.margin, bottom: o.margin, left: o.margin }
  const def = o.margin && typeof o.margin !== 'object' ? String(o.margin) : '15mm'
  const margin = { top: m.top || def, right: m.right || def, bottom: m.bottom || def, left: m.left || def }
  // con cabecera/pie hace falta hueco para ellos
  if (o.header && !(typeof o.margin === 'object' && o.margin.top)) margin.top = '22mm'
  if (o.footer && !(typeof o.margin === 'object' && o.margin.bottom)) margin.bottom = '20mm'
  return {
    engine: o.engine ? String(o.engine).toLowerCase() : null,
    size,
    landscape: o.orientation === 'landscape',
    margin,
    header: o.header ? String(o.header) : '',
    footer: o.footer ? String(o.footer) : '',
  }
}

/** Ancho útil de la página en px (96 dpi) para el <mj-body> de los layouts de documento */
export function contentWidthPx(opts) {
  const [w, h] = PAGE_SIZES[opts.size]
  const width = opts.landscape ? h : w
  return Math.floor(((width - toMm(opts.margin.left) - toMm(opts.margin.right)) / 25.4) * 96)
}

function toMm(v) {
  const m = String(v).trim().match(/^([\d.]+)\s*(mm|cm|in|px)?$/)
  if (!m) return 15
  const n = Number(m[1])
  return { mm: n, cm: n * 10, in: n * 25.4, px: (n / 96) * 25.4 }[m[2] || 'mm']
}

// ── HTML de impresión ─────────────────────────────────────────

/** Contenido CSS de una caja de margen: "Pág. {page} / {pages}" → "Pág. " counter(page) " / " counter(pages) */
export function marginBoxContent(text, title = '') {
  const str = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
  const parts = []
  let rest = String(text)
  const re = /\{(page|pages|title)\}/
  let m
  while ((m = rest.match(re))) {
    if (m.index) parts.push(str(rest.slice(0, m.index)))
    parts.push(m[1] === 'title' ? str(title) : `counter(${m[1]})`)
    rest = rest.slice(m.index + m[0].length)
  }
  if (rest) parts.push(str(rest))
  return parts.join(' ') || '""'
}

/** CSS de impresión que se inyecta en el HTML compilado */
export function printCss(opts, { title = '', mediaRules = '' } = {}) {
  const { top, right, bottom, left } = opts.margin
  const band = 'font: 9px Helvetica, Arial, sans-serif; color: #4b5563;'
  const boxes = [
    opts.header ? `@top-center { content: ${marginBoxContent(opts.header, title)}; ${band} }` : '',
    opts.footer ? `@bottom-center { content: ${marginBoxContent(opts.footer, title)}; ${band} }` : '',
  ].filter(Boolean).join(' ')
  return [
    `@page { size: ${opts.size} ${opts.landscape ? 'landscape' : 'portrait'}; margin: ${top} ${right} ${bottom} ${left}; ${boxes} }`,
    'html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    'body { margin: 0 !important; }',
    '.tpl-page-break { page-break-after: always; break-after: page; height: 0; }',
    'table, tr, img { page-break-inside: avoid; break-inside: avoid; }',
    // las tablas de maquetación de MJML ocupan todo el ancho en cualquier motor
    'table[width="100%"] { width: 100% !important; }',
    // reglas de columnas que MJML pone en @media screen: en papel siempre aplican
    mediaRules,
  ].filter(Boolean).join('\n')
}

/** Extrae el contenido de las @media de escritorio de MJML (min-width:480px) */
function desktopMediaRules(html) {
  const out = []
  const re = /@media only screen and \(min-width:\s*480px\)\s*\{/g
  let m
  while ((m = re.exec(html))) {
    let i = m.index + m[0].length
    let depth = 1
    const start = i
    while (depth && i < html.length) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') depth--
      i++
    }
    out.push(html.slice(start, i - 1).trim())
  }
  return out.join('\n')
}

export function injectPrintCss(html, opts, { title = '' } = {}) {
  const css = printCss(opts, { title, mediaRules: desktopMediaRules(html) })
  return html
    .replace('</head>', `<style type="text/css" data-tpl-print>\n${css}\n</style>\n</head>`)
    // en un documento no aplica el rol "email" que añade MJML
    .replace(/\saria-roledescription="email"/, '')
    .replace(/(<div[^>]*?)\srole="article"/, '$1 role="document"')
}

// ── Motores ───────────────────────────────────────────────────

/**
 * Motores de PDF, por orden de preferencia para accesibilidad (PDF/UA-1):
 * - weasyprint: libre (BSD), genera PDF/UA-1 (`--pdf-variant pdf/ua-1`).
 * - prince: comercial, referencia en PDF/UA (`--pdf-profile=PDF/UA-1`).
 * - chromium: etiqueta el PDF, pero no cumple PDF/UA-1 (metadatos, artefactos, enlaces).
 */
export const PDF_ENGINES = {
  weasyprint: {
    label: 'WeasyPrint', pdfua: true, license: 'Libre (BSD)',
    install: 'pip install weasyprint  (≥ 58)',
    bin: () => process.env.TEMPLAITOR_WEASYPRINT || 'weasyprint',
  },
  prince: {
    label: 'Prince', pdfua: true, license: 'Comercial',
    install: 'https://www.princexml.com/download/',
    bin: () => process.env.TEMPLAITOR_PRINCE || 'prince',
  },
  chromium: {
    label: 'Chromium (Playwright)', pdfua: false, license: 'Libre (Apache 2.0)',
    install: 'npm i -D playwright && npx playwright install chromium',
  },
}

export const ENGINE_ORDER = ['weasyprint', 'prince', 'chromium']

const availability = new Map()

export function engineAvailable(id) {
  if (!availability.has(id)) {
    let ok = false
    if (id === 'chromium') {
      try { loadPlaywright(); ok = true } catch {}
    } else if (PDF_ENGINES[id]) {
      ok = spawnSync(PDF_ENGINES[id].bin(), ['--version'], { stdio: 'ignore', timeout: 15000 }).status === 0
    }
    availability.set(id, ok)
  }
  return availability.get(id)
}

export function listEngines() {
  return ENGINE_ORDER.map(id => ({ id, ...PDF_ENGINES[id], bin: undefined, available: engineAvailable(id) }))
}

/** Motor efectivo: el pedido (si está disponible) o el primero disponible por orden de accesibilidad */
export function resolveEngine(requested) {
  const want = String(requested || process.env.TEMPLAITOR_PDF_ENGINE || 'auto').toLowerCase()
  if (want !== 'auto') {
    if (!PDF_ENGINES[want]) throw httpErr(400, `Motor de PDF desconocido: ${want} (usa ${ENGINE_ORDER.join(', ')} o auto)`)
    if (!engineAvailable(want)) throw httpErr(501, `El motor ${PDF_ENGINES[want].label} no está instalado: ${PDF_ENGINES[want].install}`)
    return want
  }
  const found = ENGINE_ORDER.find(engineAvailable)
  if (!found) throw httpErr(501, `No hay ningún motor de PDF instalado. Recomendado (PDF/UA): ${PDF_ENGINES.weasyprint.install}`)
  return found
}

/** Opciones por motor para el backend (se escriben en <nombre>.<locale>.pdf.json) */
export function engineOptions(opts) {
  return {
    weasyprint: { args: ['--pdf-variant', 'pdf/ua-1'] },
    prince: { args: ['--pdf-profile=PDF/UA-1'] },
    chromium: chromiumPdfOptions(opts),
  }
}

/** Opciones para page.pdf() de Chromium (cabecera/pie van en CSS @page: requiere Chromium ≥ 131) */
export function chromiumPdfOptions(opts) {
  return {
    format: opts.size,
    landscape: opts.landscape,
    printBackground: true,
    preferCSSPageSize: true,
    // PDF etiquetado y marcadores desde los encabezados (no llega a PDF/UA-1)
    tagged: true,
    outline: true,
    margin: opts.margin,
  }
}

// ── Render ─────────────────────────────────────────────────────

/**
 * Renderiza a PDF un HTML ya renderizado con datos.
 * Las rutas `/static/...` se sirven desde `staticDir`; el resto de URLs (fuentes, imágenes externas) se cargan normalmente.
 * Devuelve { pdf: Buffer, engine }.
 */
export async function renderPdf(html, opts, { staticDir, engine } = {}) {
  const id = resolveEngine(engine ?? opts.engine)
  const pdf = id === 'chromium'
    ? await renderChromium(html, opts, { staticDir })
    : await renderCli(id, html, { staticDir })
  return { pdf, engine: id }
}

async function renderCli(id, html, { staticDir }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-pdf-'))
  try {
    const input = path.join(dir, 'document.html')
    const output = path.join(dir, 'document.pdf')
    // /static/... → ficheros locales
    const local = staticDir ? html.replace(/(["'(])\/static\//g, `$1${pathToFileUrl(staticDir)}/`) : html
    fs.writeFileSync(input, local)
    const base = pathToFileUrl(staticDir || dir) + '/'
    const args = id === 'weasyprint'
      ? ['--pdf-variant', 'pdf/ua-1', '--base-url', base, input, output]
      : ['--pdf-profile=PDF/UA-1', '--baseurl', base, input, '-o', output]
    const { code, stderr } = await run(PDF_ENGINES[id].bin(), args, 120000)
    if (code !== 0 || !fs.existsSync(output)) {
      throw httpErr(500, `${PDF_ENGINES[id].label} falló (${code}): ${stderr.split('\n').filter(l => !/^WARNING/i.test(l)).slice(-5).join(' ').trim()}`)
    }
    return fs.readFileSync(output)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Chromium (Playwright): navegador compartido entre peticiones
let browserPromise = null

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name) } catch {}
  }
  throw httpErr(501, `Chromium no disponible: ${PDF_ENGINES.chromium.install}`)
}

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = loadPlaywright()
    const executablePath = process.env.TEMPLAITOR_CHROMIUM || undefined
    browserPromise = chromium.launch({ executablePath, args: executablePath ? ['--no-sandbox', '--headless'] : [] })
      .catch((e) => { browserPromise = null; throw e })
    process.once('exit', () => browserPromise?.then(b => b.close()).catch(() => {}))
  }
  return browserPromise
}

export async function closePdfBrowser() {
  const b = browserPromise
  browserPromise = null
  if (b) await (await b).close().catch(() => {})
}

const BASE = 'http://templaitor.local/'

async function renderChromium(html, opts, { staticDir }) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.route(`${BASE}**`, async (route) => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/static\//, '')
      const file = staticDir && path.resolve(staticDir, rel)
      if (file && file.startsWith(staticDir + path.sep) && fs.existsSync(file)) {
        return route.fulfill({ body: fs.readFileSync(file), contentType: mimeOf(file) })
      }
      return route.fulfill({ status: 404, body: '' })
    })
    const withBase = html.includes('<head>') ? html.replace('<head>', `<head><base href="${BASE}">`) : `<base href="${BASE}">${html}`
    await page.setContent(withBase, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
    await page.emulateMedia({ media: 'print' })
    return await page.pdf(chromiumPdfOptions(opts))
  } finally {
    await page.close().catch(() => {})
  }
}

// ── utilidades ────────────────────────────────────────────────

export function run(cmd, args, timeout = 60000) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(cmd, args, { timeout })
    } catch (e) {
      return resolve({ code: -1, stdout, stderr: e.message })
    }
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', e => resolve({ code: -1, stdout, stderr: e.message }))
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

function pathToFileUrl(p) {
  return `file://${path.resolve(p).split(path.sep).map(encodeURIComponent).join('/')}`
}

function mimeOf(file) {
  return { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2' }[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function httpErr(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export function pdfAvailable() {
  return ENGINE_ORDER.some(engineAvailable)
}
