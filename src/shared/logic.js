// Jinja2 logic of a block: "show only if" ({% if %}) and "repeat for each" ({% for %}).
//
// Stored as <mj-raw> markers right around the block — the format MJML and Jinja2 already understand:
//
//   <mj-raw>{% if tracking_url %}</mj-raw>
//   <mj-raw>{% for item in items %}</mj-raw>
//   …the block…
//   <mj-raw>{% endfor %}</mj-raw>
//   <mj-raw>{% endif %}</mj-raw>
//
// The editor treats the block and its markers as one unit (moved, duplicated and removed together).
// Unpaired markers are left alone: they show up as plain HTML / Jinja blocks.
import { findNode, parentId, assignIds, clone } from './mjml-tree.js'

const OPEN = /^\s*\{%-?\s*(if|for)\s+([\s\S]+?)\s*-?%\}\s*$/
const CLOSE = /^\s*\{%-?\s*(endif|endfor)\s*-?%\}\s*$/
const FOR = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)?)\s+in\s+([\s\S]+)$/

/** The marker a node is → { kind: 'if', expr } · { kind: 'for', item, list } · { kind: 'endif' | 'endfor' } · null */
export function markerOf(node) {
  if (node?.type !== 'element' || node.tag !== 'mj-raw' || node.children?.length) return null
  const content = String(node.content ?? '')
  const open = content.match(OPEN)
  if (open?.[1] === 'if') return { kind: 'if', expr: open[2].trim() }
  if (open?.[1] === 'for') {
    const f = open[2].trim().match(FOR)
    return f ? { kind: 'for', item: f[1].replace(/\s+/g, ''), list: f[2].trim() } : null
  }
  const close = content.match(CLOSE)
  return close ? { kind: close[1] } : null
}

const closes = (open, close) => close && ((open.kind === 'if' && close.kind === 'endif') || (open.kind === 'for' && close.kind === 'endfor'))

/** The unit of children[idx]: the markers wrapping it → { start, end, layers: [outer … inner] } */
export function unitOf(children, idx) {
  let start = idx
  let end = idx
  const layers = []
  while (start > 0 && end < children.length - 1) {
    const open = markerOf(children[start - 1])
    if (!open || !['if', 'for'].includes(open.kind) || !closes(open, markerOf(children[end + 1]))) break
    layers.unshift(open)
    start--
    end++
  }
  return { start, end, layers }
}

/** Logic of a unit → { if: expr | null, for: { item, list } | null } */
export function logicOf(layers) {
  const out = { if: null, for: null }
  for (const l of layers) {
    if (l.kind === 'if' && out.if == null) out.if = l.expr
    if (l.kind === 'for' && out.for == null) out.for = { item: l.item, list: l.list }
  }
  return out
}

/** Every block with logic and the markers that belong to one → { byId: { [id]: logic }, markers: Set<id>, owners: Map<marker node, block id> } */
export function logicMap(root) {
  const byId = {}
  const markers = new Set()
  const owners = new Map() // marker node → the block it wraps
  const visit = (node) => {
    const kids = node.children || []
    kids.forEach((child, i) => {
      if (markerOf(child)) return
      const u = unitOf(kids, i)
      if (!u.layers.length) return
      byId[child.id] = logicOf(u.layers)
      for (let j = u.start; j <= u.end; j++) if (j !== i) { markers.add(kids[j].id); owners.set(kids[j], child.id) }
    })
    kids.forEach(visit)
  }
  visit(root)
  return { byId, markers, owners }
}

/** Position of the unit of node `id` → { pid, parent, idx, start, end, layers } */
export function unitBounds(root, id) {
  const pid = parentId(id)
  const parent = findNode(root, pid)
  const idx = Number(String(id).split('.').pop())
  return { pid, parent, idx, ...unitOf(parent.children, idx) }
}

const raw = (content) => ({ type: 'element', tag: 'mj-raw', attrs: [], children: [], content })
const cleanExpr = (s) => String(s ?? '').replace(/\{%|%\}|\{\{|\}\}/g, '').replace(/\s+/g, ' ').trim()

/** Normalized logic, or an error message for invalid input */
export function normalizeLogic({ if: cond, for: loop } = {}) {
  const expr = cleanExpr(cond)
  let f = null
  if (loop && (String(loop.item ?? '').trim() || String(loop.list ?? '').trim())) {
    const item = String(loop.item ?? '').trim().replace(/\s*,\s*/g, ',') || 'item'
    const list = cleanExpr(loop.list)
    if (!/^[A-Za-z_]\w*(,[A-Za-z_]\w*)?$/.test(item)) return { error: `"${loop.item}" is not a valid loop variable` }
    if (!list) return { error: 'The loop needs a list to repeat over' }
    f = { item, list }
  }
  return { if: expr || null, for: f }
}

/**
 * Sets the logic of node `id` (replaces its markers; `if` outside `for`) → the node's new id.
 * logic: { if: 'expr' | null, for: { item, list } | null }
 */
export function setLogic(root, id, logic) {
  const { parent, idx, start, end } = unitBounds(root, id)
  const node = parent.children[idx]
  const n = normalizeLogic(logic)
  if (n.error) throw new Error(n.error)
  const opens = [...(n.if ? [raw(`{% if ${n.if} %}`)] : []), ...(n.for ? [raw(`{% for ${n.for.item.replace(',', ', ')} in ${n.for.list} %}`)] : [])]
  const closing = [...(n.for ? [raw('{% endfor %}')] : []), ...(n.if ? [raw('{% endif %}')] : [])]
  parent.children.splice(start, end - start + 1, ...opens, node, ...closing)
  assignIds(root)
  return node.id
}

/** Removes the unit of `id` (the block and its markers) */
export function removeUnit(root, id) {
  const { parent, start, end } = unitBounds(root, id)
  parent.children.splice(start, end - start + 1)
  assignIds(root)
}

/** Copies the unit of `id` right after it → id of the copy */
export function duplicateUnit(root, id) {
  const { parent, idx, start, end } = unitBounds(root, id)
  const copy = parent.children.slice(start, end + 1).map(clone)
  parent.children.splice(end + 1, 0, ...copy)
  assignIds(root)
  return parent.children[end + 1 + (idx - start)].id
}

/** Moves the unit of `id` to `index` of `targetPid` (index counted before the move) → new id of the block */
export function moveUnit(root, id, targetPid, index) {
  const { pid, parent, idx, start, end } = unitBounds(root, id)
  if (targetPid === id || String(targetPid).startsWith(`${id}.`)) return id
  const target = findNode(root, targetPid)
  const nodes = parent.children.splice(start, end - start + 1)
  if (pid === targetPid && index > start) index = Math.max(start, index - nodes.length)
  target.children.splice(index, 0, ...nodes)
  assignIds(root)
  return nodes[idx - start].id
}

/** The units of a parent in order (block + its markers, or a lone node) → [{ start, end, idx }] */
export function unitsOf(children) {
  const out = []
  let i = 0
  while (i < children.length) {
    // a lone marker can still open the unit of a later block: find the block it wraps
    let found = null
    for (let j = i; j < children.length; j++) {
      if (markerOf(children[j])) continue
      const u = unitOf(children, j)
      if (u.start === i) found = { start: u.start, end: u.end, idx: j }
      break
    }
    out.push(found ?? { start: i, end: i, idx: i })
    i = (found?.end ?? i) + 1
  }
  return out
}
