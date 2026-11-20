// Comprobación de accesibilidad (WCAG 2.1 AA · EN 301 549) del HTML compilado.
//
// Se ejecuta en cada compilación/vista previa. Analiza los estilos en línea que
// genera MJML (no aplica hojas de estilo), así que el contraste es una estimación
// fiable para emails, donde todo el estilo va en línea.
//
// Cada incidencia: { rule, level: 'error' | 'warn', wcag, message, hint }

import { parseDocument } from 'htmlparser2'

const VAGUE_LINKS = new Set([
  'aquí', 'aqui', 'clic aquí', 'click aquí', 'haz clic aquí', 'haz click aquí', 'pincha aquí', 'pulsa aquí',
  'más', 'leer más', 'ver más', 'enlace', 'here', 'click here', 'more', 'read more', 'link', 'this link',
])

// Criterios del informe (agrupan las reglas individuales)
export const CHECKS = [
  { id: 'lang', wcag: '3.1.1', title: 'Idioma del documento', rules: ['lang'] },
  { id: 'title', wcag: '2.4.2', title: 'Título del documento', rules: ['title'] },
  { id: 'headings', wcag: '1.3.1 · 2.4.6', title: 'Estructura de encabezados', rules: ['headings', 'heading-order', 'heading-empty', 'h1'] },
  { id: 'images', wcag: '1.1.1', title: 'Texto alternativo de las imágenes', rules: ['img-alt'] },
  { id: 'links', wcag: '2.4.4', title: 'Enlaces con texto descriptivo', rules: ['link-name', 'link-vague'] },
  { id: 'tables', wcag: '1.3.1', title: 'Tablas de datos con encabezados', rules: ['table-headers', 'th-scope'] },
  { id: 'contrast', wcag: '1.4.3', title: 'Contraste de color (AA)', rules: ['contrast'] },
  { id: 'text-size', wcag: '1.4.4', title: 'Tamaño del texto', rules: ['font-size'] },
]

/** Lista de incidencias (lo que usan la compilación y los avisos) */
export function checkAccessibility(html, opts = {}) {
  return accessibilityReport(html, opts).issues
}

/**
 * Informe completo: incidencias, estado por criterio e inventario
 * (encabezados, imágenes, enlaces, tablas, pares de contraste).
 */
export function accessibilityReport(html, { format = 'email', sourceImages = [] } = {}) {
  const issues = []
  const inventory = { lang: null, title: '', headings: [], images: [], links: [], tables: 0, contrast: [] }
  const seen = new Set()
  const add = (rule, level, wcag, message, hint, key = message) => {
    if (seen.has(`${rule}|${key}`)) return
    seen.add(`${rule}|${key}`)
    issues.push({ rule, level, wcag, message, hint })
  }
  const doc = parseDocument(html, { decodeEntities: true })
  const htmlEl = find(doc, n => n.name === 'html')

  // 1. Idioma (3.1.1)
  const lang = htmlEl?.attribs?.lang
  inventory.lang = lang || null
  if (!lang || lang === 'und') {
    add('lang', 'error', '3.1.1', 'El documento no declara su idioma', 'Usa <mjml lang="$lang"> en el layout (o en la plantilla).')
  }

  // 2. Título (2.4.2)
  const title = textOf(find(doc, n => n.name === 'title')).trim()
  inventory.title = title
  if (!title) add('title', 'error', '2.4.2', 'El documento no tiene título', `Define el ${format === 'pdf' ? 'título (subject)' : 'asunto (subject)'} en el .yml: se usa como <title>.`)

  // 3. Encabezados (1.3.1 · 2.4.6)
  const headings = findAll(doc, n => /^h[1-6]$/.test(n.name || ''))
  inventory.headings = headings.map(h => ({ level: Number(h.name[1]), text: shorten(textOf(h), 80) }))
  if (!headings.length) {
    add('headings', 'warn', '1.3.1', 'No hay encabezados', 'Marca el título principal como «Título 1» (h1) en el inspector del texto.')
  } else {
    let prev = 0
    for (const h of headings) {
      const level = Number(h.name[1])
      if (prev && level > prev + 1) add('heading-order', 'warn', '1.3.1', `Salto de nivel de encabezado: h${prev} → h${level}`, 'No te saltes niveles (h1 → h2 → h3).')
      if (!textOf(h).trim()) add('heading-empty', 'error', '1.3.1', `Encabezado h${level} vacío`, 'Elimina el encabezado o dale texto.')
      prev = level
    }
    if (!headings.some(h => h.name === 'h1')) add('h1', 'warn', '1.3.1', 'No hay encabezado principal (h1)', 'Marca el título principal como «Título 1».')
  }

  // 4. Imágenes (1.1.1)
  for (const img of findAll(doc, n => n.name === 'img')) {
    inventory.images.push({ src: img.attribs.src || '', alt: img.attribs.alt ?? null })
    if (img.attribs.alt === undefined) {
      add('img-alt', 'error', '1.1.1', `Imagen sin atributo alt: ${shorten(img.attribs.src)}`, 'Describe la imagen en «Texto alternativo» (alt="" solo si es decorativa).')
    }
  }
  for (const src of sourceImages) {
    add('img-alt', 'error', '1.1.1', `Imagen sin texto alternativo: ${shorten(src)}`, 'Rellena «Texto alternativo» del bloque Imagen; déjalo vacío (alt="") solo si es decorativa.')
  }

  // 5. Enlaces (2.4.4 · 4.1.2)
  for (const a of findAll(doc, n => n.name === 'a' && n.attribs.href !== undefined)) {
    const name = accessibleName(a)
    inventory.links.push({ text: shorten(name, 60), href: a.attribs.href })
    if (!name) {
      add('link-name', 'error', '2.4.4', `Enlace sin texto: ${shorten(a.attribs.href)}`, 'Un enlace necesita texto o una imagen con alt que describa su destino.')
    } else if (VAGUE_LINKS.has(name.toLowerCase().replace(/[.:…!]+$/, ''))) {
      add('link-vague', 'warn', '2.4.4', `Texto de enlace poco descriptivo: «${name}»`, 'Usa un texto que explique el destino (p.ej. «Verificar mi email»).')
    }
  }

  // 6. Tablas de datos (1.3.1)
  for (const table of findAll(doc, n => n.name === 'table' && n.attribs.role !== 'presentation')) {
    const ths = findAll(table, n => n.name === 'th')
    if (ths.length || findAll(table, n => n.name === 'td').length > 1) inventory.tables++
    if (!ths.length) {
      if (findAll(table, n => n.name === 'td').length > 1) {
        add('table-headers', 'warn', '1.3.1', 'Tabla sin celdas de encabezado', 'Usa <th scope="col"> en la cabecera, o role="presentation" si es solo maquetación.')
      }
    } else if (ths.some(th => !th.attribs.scope)) {
      add('th-scope', 'warn', '1.3.1', 'Encabezados de tabla sin scope', 'Añade scope="col" (o "row") a cada <th>.')
    }
  }

  // 7. Contraste (1.4.3) y tamaño de letra
  walkStyles(doc, (text, s) => {
    if (s.hidden || s.fontSize === 0) return
    const fg = parseColor(s.color)
    const bg = parseColor(s.background)
    if (fg && bg) {
      const ratio = contrast(fg, bg)
      const large = s.fontSize >= 24 || (s.fontSize >= 18.66 && s.bold)
      const min = large ? 3 : 4.5
      const pairKey = `${s.color}|${s.background}|${large}`
      if (!inventory.contrast.some(c => c.key === pairKey)) {
        inventory.contrast.push({ key: pairKey, fg: s.color, bg: s.background, ratio: Math.round(ratio * 100) / 100, min, large, pass: ratio >= min, sample: shorten(text, 40) })
      }
      if (ratio < min) {
        add('contrast', 'error', '1.4.3', `Contraste insuficiente ${ratio.toFixed(2)}:1 (mín. ${min}:1) — ${s.color} sobre ${s.background}: «${shorten(text, 40)}»`, 'Oscurece el texto o aclara el fondo.', `${s.color}|${s.background}|${large}`)
      }
    }
    if (s.fontSize && s.fontSize < 12) {
      add('font-size', 'warn', '1.4.4', `Texto de ${s.fontSize}px: «${shorten(text, 40)}»`, 'Usa al menos 12px (mejor 14px) para que sea legible.', String(s.fontSize))
    }
  })

  const checks = CHECKS.map((c) => {
    const found = issues.filter(i => c.rules.includes(i.rule))
    const status = found.some(i => i.level === 'error') ? 'fail' : found.length ? 'warn' : 'pass'
    const na = (c.id === 'images' && !inventory.images.length) || (c.id === 'links' && !inventory.links.length) || (c.id === 'tables' && !inventory.tables)
    return { ...c, status: na && status === 'pass' ? 'na' : status, issues: found }
  })
  if (format === 'pdf') {
    checks.push({
      id: 'pdf-ua', wcag: 'PDF/UA', title: 'PDF etiquetado (estructura, idioma, título y marcadores)', rules: [], issues: [],
      status: checks.find(c => c.id === 'lang').status === 'fail' || checks.find(c => c.id === 'title').status === 'fail' ? 'warn' : 'pass',
    })
  }
  inventory.contrast.sort((a, b) => a.ratio - b.ratio)
  return { standard: format === 'pdf' ? 'WCAG 2.1 AA · EN 301 549 · PDF/UA' : 'WCAG 2.1 AA · EN 301 549', issues, checks, inventory }
}

/** Imágenes del código MJML sin atributo alt (MJML pone alt="" por defecto y no se distinguiría de una decorativa) */
export function imagesWithoutAlt(mjmlSource) {
  const out = []
  for (const m of mjmlSource.matchAll(/<(mj-image|img)\b([^>]*)>/g)) {
    if (!/\salt\s*=/.test(m[2])) out.push(m[2].match(/\ssrc\s*=\s*["']([^"']*)/)?.[1] || m[1])
  }
  return out
}

// ── DOM helpers ───────────────────────────────────────────────

function find(node, pred) {
  for (const c of node.children || []) {
    if (pred(c)) return c
    const r = find(c, pred)
    if (r) return r
  }
  return null
}

function findAll(node, pred, out = []) {
  for (const c of node.children || []) {
    if (pred(c)) out.push(c)
    findAll(c, pred, out)
  }
  return out
}

function textOf(node) {
  if (!node) return ''
  if (node.type === 'text') return node.data
  if (node.type === 'comment' || node.name === 'style' || node.name === 'script') return ''
  return (node.children || []).map(textOf).join('')
}

function accessibleName(a) {
  const label = a.attribs['aria-label']
  if (label?.trim()) return label.trim()
  const parts = []
  const walk = (n) => {
    if (n.type === 'text') parts.push(n.data)
    else if (n.name === 'img') parts.push(n.attribs.alt || '')
    else (n.children || []).forEach(walk)
  }
  walk(a)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

const shorten = (s = '', n = 60) => {
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// Herencia de estilos en línea: color, fondo, tamaño y peso
function walkStyles(doc, onText) {
  const visit = (node, inherited) => {
    if (node.type === 'text') {
      const text = node.data.replace(/\s+/g, ' ').trim()
      if (text && !/^[\s‌ &;#\w]*$/.test(text) === false || text.replace(/[‌ ]/g, '').trim()) {
        if (text.replace(/[‌ \s]/g, '')) onText(text, inherited)
      }
      return
    }
    if (node.type === 'root') { for (const c of node.children || []) visit(c, inherited); return }
    if (node.type !== 'tag' || ['head', 'style', 'script', 'title'].includes(node.name)) return
    const st = parseStyle(node.attribs.style || '')
    const next = { ...inherited }
    const inherit = (v) => !v || /^(inherit|currentcolor|initial|unset)$/i.test(v)
    if (!inherit(st.color)) next.color = st.color
    const bg = st['background-color'] || bgFromShorthand(st.background) || node.attribs.bgcolor
    if (bg && parseColor(bg)) next.background = bg
    if (!inherit(st['font-size'])) next.fontSize = toPx(st['font-size'], inherited.fontSize)
    if (!inherit(st['font-weight'])) next.bold = /bold|[6-9]00/.test(st['font-weight'])
    if (['b', 'strong', 'th'].includes(node.name) || /^h[1-6]$/.test(node.name)) next.bold = true
    if (/^h[12]$/.test(node.name) && !st['font-size'] && !st.font) next.fontSize = Math.max(next.fontSize, 24)
    if (st.display === 'none' || st['max-height'] === '0px' || st.opacity === '0' || node.attribs['aria-hidden'] === 'true') next.hidden = true
    if (node.name === 'a' && !st.color) next.color = '#0000ee'
    for (const c of node.children || []) visit(c, next)
  }
  visit(doc, { color: '#000000', background: '#ffffff', fontSize: 16, bold: false, hidden: false })
}

function parseStyle(style) {
  const out = {}
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).replace(/!important/, '').trim()
  }
  return out
}

function bgFromShorthand(v) {
  if (!v) return null
  return v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(white|black|transparent)\b/i)?.[0] || null
}

function toPx(v, parent = 16) {
  const m = String(v).match(/^([\d.]+)\s*(px|pt|em|rem|%)?$/)
  if (!m) return parent
  const n = Number(m[1])
  return { px: n, pt: (n * 96) / 72, em: n * parent, rem: n * 16, '%': (n / 100) * parent }[m[2] || 'px']
}

const NAMED = { white: [255, 255, 255], black: [0, 0, 0] }

export function parseColor(v) {
  if (!v || /\{\{|\$param|transparent/.test(v)) return null
  const s = String(v).trim().toLowerCase()
  if (NAMED[s]) return NAMED[s]
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/)
  if (m && (m[4] === undefined || Number(m[4]) >= 0.99)) return [m[1], m[2], m[3]].map(Number)
  return null
}

export function contrast(a, b) {
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
