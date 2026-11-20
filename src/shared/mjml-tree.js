// Parser / serializador MJML sin pérdidas relevantes, usable en Node y navegador.
//
// Preserva todo lo que no es una etiqueta MJML como nodos `text` (comandos $,
// bloques Jinja2 {% %}, $import(...), etc.) y el contenido de las etiquetas
// "ending" (mj-text, mj-button, mj-raw...) como HTML en crudo.
//
import { findImportCalls, parseImportCall } from './imports.js'

// Nodos:
//   { type: 'root', children }
//   { type: 'element', tag, attrs: [[name, value]], children, content }   // content !== null => ending tag
//   { type: 'text', value }
//   { type: 'comment', value }
//
// Los ids son rutas de índices ("0.2.1") calculadas por `assignIds`; son
// deterministas, de modo que cliente y servidor obtienen los mismos ids al
// parsear el mismo texto.

export const ENDING_TAGS = new Set([
  'mj-text', 'mj-button', 'mj-raw', 'mj-table', 'mj-navbar-link',
  'mj-accordion-title', 'mj-accordion-text', 'mj-social-element',
  'mj-style', 'mj-title', 'mj-preview',
])

const TAG_RE = /<(\/?)(mj[\w-]*|mjml)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gy
const ATTR_RE = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

// ── Frontmatter ───────────────────────────────────────────────

export function splitFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { frontmatter: '', body: source }
  return { frontmatter: m[1], body: m[2] }
}

export function joinFrontmatter(frontmatter, body) {
  if (!frontmatter || !frontmatter.trim()) return body
  return `---\n${frontmatter.trim()}\n---\n\n${body.replace(/^\s+/, '')}`
}

// ── Parse ────────────────────────────────────────────────────

export function parseAttrs(str) {
  const attrs = []
  ATTR_RE.lastIndex = 0
  let m
  while ((m = ATTR_RE.exec(str))) {
    attrs.push([m[1], m[2] ?? m[3] ?? m[4] ?? ''])
  }
  return attrs
}

export function parse(source) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  let i = 0
  let textStart = 0

  const pushText = (end) => {
    if (end <= textStart) return
    const value = source.slice(textStart, end)
    // cada $import (instancia de componente) y cada bloque separado por línea en blanco es un nodo
    let last = 0
    const pushParts = (str) => {
      for (const part of str.split(/\n\s*\n/)) if (part.trim()) top().children.push({ type: 'text', value: part.trim() })
    }
    for (const call of findImportCalls(value)) {
      pushParts(value.slice(last, call.start))
      top().children.push({ type: 'text', value: call.raw })
      last = call.end
    }
    pushParts(value.slice(last))
  }
  const top = () => stack[stack.length - 1]

  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) break

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      const stop = end === -1 ? source.length : end + 3
      pushText(lt)
      top().children.push({ type: 'comment', value: source.slice(lt + 4, end === -1 ? source.length : end).trim() })
      i = textStart = stop
      continue
    }

    TAG_RE.lastIndex = lt
    const m = TAG_RE.exec(source)
    if (!m) { i = lt + 1; continue }

    const [full, closing, tag, attrStr, selfClosing] = m
    pushText(lt)
    i = textStart = lt + full.length

    if (closing) {
      // cerrar hasta encontrar la etiqueta correspondiente (tolerante)
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === tag) { stack.length = s; break }
      }
      continue
    }

    const node = { type: 'element', tag, attrs: parseAttrs(attrStr), children: [], content: null }
    top().children.push(node)
    if (selfClosing) continue

    if (ENDING_TAGS.has(tag)) {
      const closeTag = `</${tag}>`
      const end = source.indexOf(closeTag, i)
      const stop = end === -1 ? source.length : end
      node.content = dedent(source.slice(i, stop))
      i = textStart = end === -1 ? source.length : end + closeTag.length
      continue
    }
    stack.push(node)
  }
  pushText(source.length)
  return assignIds(root)
}

export function assignIds(root) {
  const walk = (node, prefix) => {
    node.children?.forEach((child, idx) => {
      child.id = prefix ? `${prefix}.${idx}` : String(idx)
      walk(child, child.id)
    })
  }
  root.id = ''
  walk(root, '')
  return root
}

function dedent(str) {
  const lines = str.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n')
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length))
  if (!Number.isFinite(indent)) return str.trim()
  return lines.map(l => l.slice(indent)).join('\n')
}

// ── Serialize ────────────────────────────────────────────────

const escapeAttr = (v) => String(v).replace(/"/g, '&quot;')

function openTag(node, extraAttrs) {
  const attrs = extraAttrs ? extraAttrs(node) : node.attrs
  const a = attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')
  return `<${node.tag}${a}`
}

export function serialize(root, { indent = '  ', extraAttrs, transformContent, transformText } = {}) {
  const out = []
  const walk = (node, depth) => {
    const pad = indent.repeat(depth)
    if (node.type === 'text') {
      const value = transformText ? transformText(node) : node.value
      out.push(value.split('\n').map(l => pad + l.trim()).join('\n'))
      return
    }
    if (node.type === 'comment') { out.push(`${pad}<!-- ${node.value} -->`); return }

    const open = openTag(node, extraAttrs)
    if (node.content !== null && node.content !== undefined) {
      const content = transformContent ? transformContent(node) : node.content
      if (!content.includes('\n')) {
        out.push(`${pad}${open}>${content.length > 40 ? `\n${pad}${indent}${content}\n${pad}` : content}</${node.tag}>`)
      } else {
        const body = content.split('\n').map(l => (l.trim() ? pad + indent + l : '')).join('\n')
        out.push(`${pad}${open}>\n${body}\n${pad}</${node.tag}>`)
      }
      return
    }
    if (!node.children.length) { out.push(`${pad}${open} />`); return }
    out.push(`${pad}${open}>`)
    node.children.forEach(c => walk(c, depth + 1))
    out.push(`${pad}</${node.tag}>`)
  }
  root.children.forEach((c, idx) => {
    // línea en blanco entre bloques de primer nivel para legibilidad
    if (idx > 0 && c.type === 'element') out.push('')
    walk(c, 0)
  })
  return out.join('\n') + '\n'
}

// ── Tree helpers ─────────────────────────────────────────────

/** Si el nodo es exactamente un `$import(ruta, ...)` devuelve { path, params } */
export function importCall(node) {
  if (node?.type !== 'text') return null
  return parseImportCall(node.value)
}

/** Ruta del `$import` si el nodo es una instancia de componente/parcial */
export function importRef(node) {
  return importCall(node)?.path ?? null
}

export function findNode(root, id) {
  if (id === '' || id == null) return root
  let node = root
  for (const idx of String(id).split('.')) {
    node = node?.children?.[Number(idx)]
    if (!node) return null
  }
  return node
}

export function parentId(id) {
  const parts = String(id).split('.')
  parts.pop()
  return parts.join('.')
}

export function walk(root, fn, parent = null) {
  fn(root, parent)
  root.children?.forEach(c => walk(c, fn, root))
}

export function getAttr(node, name) {
  return node.attrs?.find(([k]) => k === name)?.[1]
}

export function setAttr(node, name, value) {
  const idx = node.attrs.findIndex(([k]) => k === name)
  if (value === undefined || value === null || value === '') {
    if (idx !== -1) node.attrs.splice(idx, 1)
  } else if (idx === -1) {
    node.attrs.push([name, String(value)])
  } else {
    node.attrs[idx][1] = String(value)
  }
}

export function clone(node) {
  return JSON.parse(JSON.stringify(node))
}

/** Elimina el nodo `id` y lo devuelve */
export function removeNode(root, id) {
  const parent = findNode(root, parentId(id))
  const idx = Number(String(id).split('.').pop())
  const [removed] = parent.children.splice(idx, 1)
  assignIds(root)
  return removed
}

/** Inserta `node` dentro de `parentNodeId` en la posición `index` */
export function insertNode(root, parentNodeId, index, node) {
  const parent = findNode(root, parentNodeId)
  parent.children.splice(index, 0, node)
  assignIds(root)
  return node.id
}

/** Mueve `id` a (parentNodeId, index) gestionando el desplazamiento de índices */
export function moveNode(root, id, targetParentId, index) {
  const node = findNode(root, id)
  const parent = findNode(root, targetParentId)
  const srcParent = findNode(root, parentId(id))
  const srcIdx = srcParent.children.indexOf(node)
  if (isAncestor(id, targetParentId)) return id
  srcParent.children.splice(srcIdx, 1)
  if (srcParent === parent && srcIdx < index) index--
  parent.children.splice(index, 0, node)
  assignIds(root)
  return node.id
}

export function isAncestor(ancestorId, id) {
  return id === ancestorId || String(id).startsWith(`${ancestorId}.`)
}
