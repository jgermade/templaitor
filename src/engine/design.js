// Anotación del cuerpo MJML para el editor visual (modo diseño).
//
// - Cada nodo visual recibe la clase `tpl-node--<id>` (vía css-class), lo que
//   permite mapear el HTML compilado de vuelta al árbol MJML.
// - El contenido de mj-text / mj-button se envuelve en una región editable
//   `data-tpl-edit` = `t:<clave>` (si el contenido es exactamente $t('clave'))
//   o `c:<id>` (contenido literal).
// - Los tokens Jinja2 y comandos $ se convierten en "chips" no editables que
//   guardan su código fuente en `data-tpl-src` (codificado para que ni el
//   resolvedor de comandos ni Jinja2 lo procesen).

import { parse, serialize, walk, importRef } from '../shared/mjml-tree.js'
import { NON_VISUAL, describe } from '../shared/components.js'
import { lookupMessage, parseAttrs } from './commands.js'

const NO_CLASS = new Set(['mj-raw', 'mj-body', 'mjml'])
const EXACT_T = /^\$t\(\s*['"]([^'"]+)['"]\s*\)$/

export const CHIP_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}|\$link\{[^}]*\}|\$t\(\s*['"][^'"]+['"]\s*\)|\$if\([^)]*\)[\s\S]*?\$end\b|\$import\([^)]*\)|\$lang\b|\$country\b/g

export function annotateBody(body, ctx) {
  const tree = parse(body)
  const hidden = new Set()
  walk(tree, (node) => {
    if (node.type === 'element' && (node.tag === 'mj-head' || hidden.has(node))) {
      node.children.forEach(c => hidden.add(c))
    }
  })
  const visual = (node) => node.type === 'element' && !hidden.has(node) && !NON_VISUAL.has(node.tag) && !NO_CLASS.has(node.tag)

  return serialize(tree, {
    transformText: (node) => {
      const ref = importRef(node)
      if (!ref || !ctx.readImport || hidden.has(node)) return node.value
      try {
        return annotateInstance(ctx.readImport(ref), node.id)
      } catch (err) {
        ctx.warnings?.push(err.message)
        return node.value
      }
    },
    extraAttrs: (node) => {
      if (!visual(node)) return node.attrs
      const cls = `tpl-node tpl-node--${node.id.replace(/\./g, '_')}`
      const attrs = node.attrs.filter(([k]) => k !== 'css-class')
      const prev = node.attrs.find(([k]) => k === 'css-class')?.[1]
      return [...attrs, ['css-class', prev ? `${prev} ${cls}` : cls]]
    },
    transformContent: (node) => {
      if (!visual(node) || !describe(node.tag).editable) return node.content
      const tagName = node.tag === 'mj-button' ? 'span' : 'div'
      const m = node.content.trim().match(EXACT_T)
      if (m) {
        const msg = lookupMessage(ctx.messages, m[1])
        const missing = msg === undefined || msg === null ? ' data-tpl-missing="1"' : ''
        return `<${tagName} data-tpl-edit="t:${escapeHtml(m[1])}"${missing}>${chipify(String(msg ?? '').trim())}</${tagName}>`
      }
      return `<${tagName} data-tpl-edit="c:${node.id}">${chipify(node.content)}</${tagName}>`
    },
  })
}

function annotateInstance(source, id) {
  const tree = parse(source)
  const cls = `tpl-node tpl-comp tpl-node--${id.replace(/\./g, '_')}`
  return serialize(tree, {
    extraAttrs: (node) => {
      if (node.id.includes('.') || NON_VISUAL.has(node.tag) || NO_CLASS.has(node.tag)) return node.attrs
      const prev = node.attrs.find(([k]) => k === 'css-class')?.[1]
      return [...node.attrs.filter(([k]) => k !== 'css-class'), ['css-class', prev ? `${prev} ${cls}` : cls]]
    },
  })
}

export function chipify(str) {
  return str.replace(CHIP_RE, (src) => {
    const { kind, label } = chipInfo(src)
    return `<span class="tpl-chip tpl-chip--${kind}" contenteditable="false" data-tpl-src="${encode(src)}">${encode(label)}</span>`
  })
}

export function chipInfo(src) {
  if (src.startsWith('{{')) return { kind: 'var', label: src.slice(2, -2).trim() }
  if (src.startsWith('{%')) return { kind: 'stmt', label: src.slice(2, -2).trim() }
  if (src.startsWith('{#')) return { kind: 'comment', label: src.slice(2, -2).trim() }
  if (src.startsWith('$link')) {
    const m = src.match(/^\$link\{\s*([\w.-]+)\s*(?:,([^}]*))?\}$/)
    const attrs = parseAttrs(m?.[2] || '')
    return { kind: 'link', label: attrs.label || m?.[1] || src }
  }
  if (src.startsWith('$t(')) return { kind: 't', label: src.match(/['"]([^'"]+)['"]/)[1] }
  return { kind: 'cmd', label: src.length > 40 ? `${src.slice(0, 37)}…` : src }
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function encode(s) {
  return String(s).replace(/[&<>"'$%{}#]/g, c => `&#${c.charCodeAt(0)};`)
}
