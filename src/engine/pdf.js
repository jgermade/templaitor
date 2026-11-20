// Plantillas PDF: opciones de página, CSS de impresión y render con Chromium (Playwright).
//
// Una plantilla es PDF si su frontmatter tiene `format: pdf`:
//
//   ---
//   format: pdf
//   layout: document.layout.mjml
//   pdf:
//     size: A4              # A4 · A5 · A3 · Letter · Legal
//     orientation: portrait # portrait · landscape
//     margin: 15mm          # o { top, right, bottom, left }
//     header: ""            # texto de cabecera ({page}, {pages}, {title}, {date})
//     footer: "{page} / {pages}"
//   ---
//
// La compilación sigue produciendo HTML con Jinja2 (para renderizarlo en runtime);
// el PDF se genera a partir del HTML ya renderizado con datos.

import fs from 'node:fs'
import path from 'node:path'
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

/** CSS de impresión que se inyecta en el HTML compilado */
export function printCss(opts) {
  const { top, right, bottom, left } = opts.margin
  return [
    `@page { size: ${opts.size} ${opts.landscape ? 'landscape' : 'portrait'}; margin: ${top} ${right} ${bottom} ${left}; }`,
    'html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '@media print { body { margin: 0 !important; } .tpl-page-break { page-break-after: always; break-after: page; height: 0; } }',
    'table, tr, img { page-break-inside: avoid; break-inside: avoid; }',
  ].join('\n')
}

export function injectPrintCss(html, opts) {
  return html
    .replace('</head>', `<style type="text/css" data-tpl-print>\n${printCss(opts)}\n</style>\n</head>`)
    // en un documento no aplica el rol "email" que añade MJML
    .replace(/\saria-roledescription="email"/, '')
    .replace(/(<div[^>]*?)\srole="article"/, '$1 role="document"')
}

/** Opciones para page.pdf() de Chromium (también se escriben en <nombre>.<locale>.pdf.json) */
export function chromiumPdfOptions(opts) {
  const band = (text) => `<div style="width:100%;font:9px Helvetica,Arial,sans-serif;color:#6b7280;padding:0 ${opts.margin.left};text-align:center">${
    escapeHtml(text)
      .replace(/\{page\}/g, '<span class="pageNumber"></span>')
      .replace(/\{pages\}/g, '<span class="totalPages"></span>')
      .replace(/\{title\}/g, '<span class="title"></span>')
      .replace(/\{date\}/g, '<span class="date"></span>')
  }</div>`
  return {
    format: opts.size,
    landscape: opts.landscape,
    printBackground: true,
    preferCSSPageSize: true,
    // accesibilidad (PDF/UA): PDF etiquetado con estructura y marcadores desde los encabezados
    tagged: true,
    outline: true,
    margin: opts.margin,
    displayHeaderFooter: !!(opts.header || opts.footer),
    headerTemplate: opts.header ? band(opts.header) : '<span></span>',
    footerTemplate: opts.footer ? band(opts.footer) : '<span></span>',
  }
}

// ── Render ─────────────────────────────────────────────────────

let browserPromise = null

export function pdfAvailable() {
  try { loadPlaywright(); return true } catch { return false }
}

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name) } catch {}
  }
  const err = new Error('Para generar PDF instala Playwright: npm i -D playwright && npx playwright install chromium')
  err.status = 501
  throw err
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

/**
 * Renderiza a PDF un HTML ya renderizado con datos.
 * Las rutas `/static/...` se sirven desde `staticDir`; el resto de URLs (fuentes, imágenes externas) se cargan normalmente.
 */
export async function renderPdf(html, opts, { staticDir } = {}) {
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

function mimeOf(file) {
  return { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2' }[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
