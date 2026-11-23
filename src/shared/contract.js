// Data contract of a template: the data it expects, declared in its frontmatter (`data:`).
//
//   data:
//     first_name: { type: string, required: true, description: Recipient's first name }
//     app_url: url
//     items:
//       type: list
//       required: true
//       of: { name: string, qty: number, price: number }
//     invoice: { number: string, date: date }        ← an object (no `type`): its fields
//
// Types: string · number · boolean · date · url · email · list (`of`: a type or fields) · object (fields).
// Browser-safe: used by the engine (warnings, send API validation, JSON Schema) and the editor (Data panel).

export const DATA_TYPES = ['string', 'number', 'boolean', 'date', 'url', 'email', 'list', 'object']
const SCALAR = new Set(['string', 'number', 'boolean', 'date', 'url', 'email'])

/** One field → { type, required, description, of?, fields? } */
function normalizeField(decl) {
  if (typeof decl === 'string') return normalizeField({ type: decl })
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) return { type: 'string', required: false, description: '' }
  // an object without `type` is the shorthand for an object with those fields
  if (!('type' in decl)) return { type: 'object', required: false, description: '', fields: normalizeContract(decl) }
  const type = DATA_TYPES.includes(String(decl.type)) ? String(decl.type) : 'string'
  const out = { type, required: decl.required === true, description: String(decl.description ?? '') }
  if (type === 'list') {
    const of = decl.of ?? 'string'
    out.of = typeof of === 'string' && SCALAR.has(of) ? { type: of } : { type: 'object', fields: normalizeContract(typeof of === 'object' ? of : {}) }
  }
  if (type === 'object') out.fields = normalizeContract(decl.fields ?? {})
  return out
}

/** The `data:` of a frontmatter → { [name]: field } ({} when there is none) */
export function normalizeContract(decl) {
  const out = {}
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) return out
  for (const [name, d] of Object.entries(decl)) if (/^[A-Za-z_]\w*$/.test(name)) out[name] = normalizeField(d)
  return out
}

/** Back to the short YAML form (what the editor writes into the frontmatter) */
export function contractToYaml(contract) {
  const out = {}
  for (const [name, f] of Object.entries(contract)) out[name] = fieldToYaml(f)
  return out
}

function fieldToYaml(f) {
  const extra = f.required || f.description
  if (f.type === 'object') {
    const fields = contractToYaml(f.fields || {})
    return extra ? { type: 'object', ...(f.required ? { required: true } : {}), ...(f.description ? { description: f.description } : {}), fields } : fields
  }
  const of = f.type === 'list' ? (f.of?.type === 'object' ? contractToYaml(f.of.fields || {}) : f.of?.type ?? 'string') : undefined
  if (!extra && f.type !== 'list') return f.type
  return { type: f.type, ...(f.required ? { required: true } : {}), ...(f.description ? { description: f.description } : {}), ...(of !== undefined ? { of } : {}) }
}

// ── Validation ───────────────────────────────────────────────
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URLISH = /^(https?:\/\/|\/|mailto:|tel:)\S*$/i

function checkValue(f, v, path, errors) {
  const t = f.type
  const bad = (what) => errors.push({ path, message: `must be ${what}` })
  if (t === 'string') { if (typeof v !== 'string' && typeof v !== 'number') bad('a text') }
  else if (t === 'number') { if (typeof v !== 'number' || Number.isNaN(v)) bad('a number') }
  else if (t === 'boolean') { if (typeof v !== 'boolean') bad('true or false') }
  else if (t === 'date') { if (!(typeof v === 'string' || typeof v === 'number') || Number.isNaN(Date.parse(v))) bad('a date (e.g. 2026-11-23)') }
  else if (t === 'url') { if (typeof v !== 'string' || !URLISH.test(v)) bad('a URL (https://… or /path)') }
  else if (t === 'email') { if (typeof v !== 'string' || !EMAIL.test(v)) bad('an email address') }
  else if (t === 'list') {
    if (!Array.isArray(v)) return bad('a list')
    v.forEach((item, i) => (f.of?.type === 'object'
      ? (item && typeof item === 'object' && !Array.isArray(item) ? checkObject(f.of.fields, item, `${path}[${i}]`, errors) : errors.push({ path: `${path}[${i}]`, message: 'must be an object' }))
      : checkValue({ type: f.of?.type ?? 'string' }, item, `${path}[${i}]`, errors)))
  } else if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('an object')
    checkObject(f.fields || {}, v, path, errors)
  }
}

function checkObject(fields, obj, prefix, errors) {
  for (const [name, f] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${name}` : name
    const v = obj?.[name]
    if (v === undefined || v === null || v === '') {
      if (f.required) errors.push({ path, message: 'is required' })
      continue
    }
    checkValue(f, v, path, errors)
  }
}

/** Errors of `data` against the contract → [{ path, message }] (extra fields are allowed) */
export function validateData(contract, data) {
  const errors = []
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [{ path: '', message: 'data must be an object' }]
  checkObject(contract, data, '', errors)
  return errors
}

export const formatErrors = (errors) => errors.map(e => `${e.path || 'data'}: ${e.message}`)

// ── Inference (from demo data) ───────────────────────────────
function inferField(v) {
  if (Array.isArray(v)) {
    const first = v.find(x => x != null)
    return { type: 'list', required: false, description: '', of: first && typeof first === 'object' && !Array.isArray(first) ? { type: 'object', fields: inferContract(first) } : { type: first == null ? 'string' : inferField(first).type } }
  }
  if (v && typeof v === 'object') return { type: 'object', required: false, description: '', fields: inferContract(v) }
  if (typeof v === 'number') return { type: 'number', required: false, description: '' }
  if (typeof v === 'boolean') return { type: 'boolean', required: false, description: '' }
  const s = String(v ?? '')
  const type = EMAIL.test(s) ? 'email' : /^https?:\/\//i.test(s) ? 'url' : /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(s) ? 'date' : 'string'
  return { type, required: false, description: '' }
}

/** A contract from demo data; `used` (root names the template uses) are marked required, and used names
 *  missing from the data are added as strings */
export function inferContract(data, used = null) {
  const out = {}
  for (const [name, v] of Object.entries(data || {})) if (/^[A-Za-z_]\w*$/.test(name)) out[name] = inferField(v)
  if (used) {
    for (const name of used) {
      out[name] ??= { type: 'string', required: false, description: '' }
      out[name].required = true
    }
  }
  return out
}

// ── JSON Schema ──────────────────────────────────────────────
function fieldSchema(f) {
  const d = f.description ? { description: f.description } : {}
  switch (f.type) {
    case 'number': return { type: 'number', ...d }
    case 'boolean': return { type: 'boolean', ...d }
    case 'date': return { type: 'string', format: 'date', ...d }
    case 'url': return { type: 'string', format: 'uri-reference', ...d }
    case 'email': return { type: 'string', format: 'email', ...d }
    case 'list': return { type: 'array', items: f.of?.type === 'object' ? objectSchema(f.of.fields) : fieldSchema({ type: f.of?.type ?? 'string' }), ...d }
    case 'object': return { ...objectSchema(f.fields || {}), ...d }
    default: return { type: 'string', ...d }
  }
}

function objectSchema(fields) {
  const required = Object.entries(fields).filter(([, f]) => f.required).map(([k]) => k)
  return { type: 'object', properties: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, fieldSchema(f)])), ...(required.length ? { required } : {}) }
}

/** JSON Schema (2020-12) of a contract */
export function toJsonSchema(contract, { id, title } = {}) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...(id ? { $id: id } : {}),
    ...(title ? { title } : {}),
    ...objectSchema(contract),
  }
}

// ── Variables a template uses (Jinja2) ───────────────────────
const KEYWORDS = new Set(['if', 'elif', 'else', 'endif', 'for', 'in', 'endfor', 'not', 'and', 'or', 'is', 'true', 'false', 'none',
  'True', 'False', 'None', 'loop', 'set', 'endset', 'with', 'endwith', 'defined', 'undefined', 'macro', 'endmacro', 'block', 'endblock',
  'include', 'import', 'from', 'as', 'raw', 'endraw', 'filter', 'endfilter', 'call', 'endcall', 'recursive', 'super', 'caller', 'range',
  'namespace', 'varargs', 'kwargs', 'self'])

/** Root names of the data a Jinja2 source uses (loop / set variables, filters and attributes excluded) */
export function usedVariables(source) {
  const local = new Set()
  const used = new Set()
  const tags = String(source || '').matchAll(/\{\{([\s\S]*?)\}\}|\{%-?([\s\S]*?)-?%\}/g)
  for (const m of tags) {
    let expr = (m[1] ?? m[2] ?? '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ') // no string literals
    const f = expr.match(/^\s*for\s+([\w\s,]+?)\s+in\s+([\s\S]*)$/)
    if (f) { f[1].split(',').forEach(v => local.add(v.trim())); expr = f[2] }
    const s = expr.match(/^\s*set\s+(\w+)\s*=([\s\S]*)$/)
    if (s) { local.add(s[1]); expr = s[2] }
    // identifiers that are not attributes (.x), filters (|x), keyword arguments (x=) or calls of tests
    for (const id of expr.matchAll(/(^|[^\w.|])\s*([A-Za-z_]\w*)/g)) {
      const name = id[2]
      if (KEYWORDS.has(name) || local.has(name)) continue
      const after = expr.slice(id.index + id[0].length)
      if (/^\s*=(?!=)/.test(after)) continue
      if (/\|\s*$/.test(expr.slice(0, id.index + id[1].length))) continue
      used.add(name)
    }
  }
  return [...used]
}
