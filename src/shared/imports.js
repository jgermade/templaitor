// $import calls with parameters (shared by Node and the browser).
//
//   $import(_components/cta-button, url="{{ app_url }}/verify", label="$t('cta')")
//
// Values go in double or single quotes (they may contain commas, parentheses and
// $ commands). Inside the component they are used as `$param.name`; their default
// value, type and label are declared in the component frontmatter:
//
//   ---
//   params:
//     url: { type: text, label: Link, default: "#" }
//     label: Button           # short form: just the default value
//     logo: { type: image, default: "{{ assets_url }}/logo.svg" }
//     show_logo: { type: boolean, default: true }   # → $if($param.show_logo) … $end
//   ---
//
// Types: text · color · select (options) · image (URL) · boolean (true/false, compile time)

const OPEN = '$import('

/** Finds $import(...) calls, honouring quotes and nested parentheses */
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
    if (i >= text.length) break // unterminated
    const raw = text.slice(pos, i + 1)
    calls.push({ start: pos, end: i + 1, raw, ...parseArgs(text.slice(pos + OPEN.length, i)) })
    pos = i + 1
  }
  return calls
}

/** { path, params } when `str` is exactly one $import call */
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

/** Serializes a call; `params` is an ordered list of [key, value] */
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

// ── Parameter declaration and substitution ───────────────────

/** Normalizes frontmatter `params` to { name: { type, label, default, options } } */
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

/** Replaces `$param.x` with the given value, the default value or '' (with a warning) */
export const PARAM_TYPES = ['text', 'color', 'select', 'image', 'boolean']

const TRUE = new Set(['true', '1', 'yes', 'si', 'sí', 'on'])
const FALSE = new Set(['false', '0', 'no', 'off', ''])

/** true / false / null (when the value is not boolean) */
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
      warn?.(`$param.${name} is neither declared nor passed`)
      return ''
    }
    if (d?.type === 'boolean') {
      // replaced by a JS literal to be used in $if($param.x) (compile time)
      const b = toBoolean(value)
      if (b === null) warn?.(`$param.${name} is boolean and got "${value}" (false is used)`)
      return String(!!b)
    }
    return String(value)
  })
}
