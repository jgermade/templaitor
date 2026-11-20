// Llamadas $import con parámetros (compartido Node/navegador).
//
//   $import(_components/cta-button, url="{{ app_url }}/verify", label="$t('cta')")
//
// Los valores van entre comillas dobles o simples (admiten comas, paréntesis y
// comandos $). Dentro del componente se usan como `$param.nombre`; sus valores
// por defecto, tipo y etiqueta se declaran en el frontmatter del componente:
//
//   ---
//   params:
//     url: { type: text, label: Enlace, default: "#" }
//     label: Botón            # forma corta: solo el valor por defecto
//     logo: { type: image, default: "{{ assets_url }}/logo.svg" }
//     show_logo: { type: boolean, default: true }   # → $if($param.show_logo) … $end
//   ---
//
// Tipos: text · color · select (options) · image (URL) · boolean (true/false, compile-time)

const OPEN = '$import('

/** Encuentra las llamadas $import(...) respetando comillas y paréntesis anidados */
export function findImportCalls(text) {
  const calls = []
  let pos = 0
  while ((pos = text.indexOf(OPEN, pos)) !== -1) {
    let i = pos + OPEN.length
    let depth = 0
    let quote = null
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (c === '(') depth++
      else if (c === ')') {
        if (depth === 0) break
        depth--
      }
    }
    if (i >= text.length) break // sin cerrar
    const raw = text.slice(pos, i + 1)
    calls.push({ start: pos, end: i + 1, raw, ...parseArgs(text.slice(pos + OPEN.length, i)) })
    pos = i + 1
  }
  return calls
}

/** Si `str` es exactamente una llamada $import devuelve { path, params } */
export function parseImportCall(str) {
  const s = String(str ?? '').trim()
  if (!s.startsWith(OPEN)) return null
  const [call] = findImportCalls(s)
  return call && call.start === 0 && call.end === s.length ? call : null
}

export function replaceImportCalls(text, fn) {
  let out = ''
  let last = 0
  for (const call of findImportCalls(text)) {
    out += text.slice(last, call.start) + fn(call)
    last = call.end
  }
  return out + text.slice(last)
}

/** Serializa una llamada; `params` es una lista ordenada de [clave, valor] */
export function formatImportCall(path, params = []) {
  const args = params
    .filter(([k, v]) => k && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const val = String(v)
      if (!val.includes('"')) return `${k}="${val}"`
      if (!val.includes("'")) return `${k}='${val}'`
      return `${k}="${val.replace(/"/g, '\\"')}"`
    })
  return `$import(${[path, ...args].join(', ')})`
}

function parseArgs(inner) {
  const parts = splitTopLevel(inner)
  const path = unquote(parts.shift()?.trim() ?? '')
  const params = []
  for (const part of parts) {
    const m = part.match(/^\s*([A-Za-z_][\w-]*)\s*[=:]\s*([\s\S]*?)\s*$/)
    if (m) params.push([m[1], unquote(m[2])])
  }
  return { path, params }
}

function splitTopLevel(str) {
  const parts = []
  let cur = ''
  let depth = 0
  let quote = null
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += str[++i] ?? ''
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '{') depth++
    else if (c === ')' || c === '}') depth--
    else if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim() || parts.length) parts.push(cur)
  return parts
}

function unquote(s) {
  const t = s.trim()
  const q = t[0]
  if ((q === '"' || q === "'") && t.endsWith(q) && t.length >= 2) {
    return t.slice(1, -1).replace(new RegExp(`\\\\${q}`, 'g'), q)
  }
  return t
}

// ── Declaración y sustitución de parámetros ──────────────────

/** Normaliza `params` del frontmatter a { nombre: { type, label, default, options } } */
export function normalizeParams(decl) {
  const out = {}
  for (const [name, d] of Object.entries(decl || {})) {
    out[name] = d && typeof d === 'object' && !Array.isArray(d)
      ? { type: d.type || 'text', label: d.label || name, default: d.default ?? '', options: d.options, help: d.help }
      : { type: 'text', label: name, default: d ?? '' }
  }
  return out
}

export const PARAM_RE = /\$param\.([A-Za-z_][\w-]*)/g

/** Sustituye `$param.x` por el valor dado, el valor por defecto o '' (con aviso) */
export const PARAM_TYPES = ['text', 'color', 'select', 'image', 'boolean']

const TRUE = new Set(['true', '1', 'yes', 'si', 'sí', 'on'])
const FALSE = new Set(['false', '0', 'no', 'off', ''])

/** true / false / null (si el valor no es booleano) */
export function toBoolean(value) {
  if (typeof value === 'boolean') return value
  const v = String(value ?? '').trim().toLowerCase()
  if (TRUE.has(v)) return true
  if (FALSE.has(v)) return false
  return null
}

export function applyParams(content, decl, given = [], warn) {
  const declared = normalizeParams(decl)
  const values = Object.fromEntries(given)
  return content.replace(PARAM_RE, (_, name) => {
    const d = declared[name]
    let value
    if (name in values) value = values[name]
    else if (d) value = d.default ?? ''
    else {
      warn?.(`$param.${name} no está declarado ni se ha pasado`)
      return ''
    }
    if (d?.type === 'boolean') {
      // se sustituye por un literal JS para usarlo en $if($param.x) (compile-time)
      const b = toBoolean(value)
      if (b === null) warn?.(`$param.${name} es booleano y recibió "${value}" (se usa false)`)
      return String(!!b)
    }
    return String(value)
  })
}
