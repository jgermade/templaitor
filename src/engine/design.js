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

import { parse, serialize, walk, importCall } from '../shared/mjml-tree.js'
import { NON_VISUAL, describe } from '../shared/components.js'
import { lookupMessage, parseAttrs, resolveCommands } from './commands.js'
import { normalizeParams } from '../shared/imports.js'
import { splitWrapper } from '../shared/semantics.js'

const NO_CLASS = new Set(['mj-raw', 'mj-body', 'mjml'])
const EXACT_T = /^\$t\(\s*['"]([^'"]+)['"]\s*\)$/

export const CHIP_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}|\$link\{[^}]*\}|\$t\(\s*['"][^'"]+['"]\s*\)|\$if\([^)]*\)[\s\S]*?\$end\b|\$import\([^)]*\)|\$param\.[A-Za-z_][\w-]*|\$lang\b|\$country\b/g

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
      const call = importCall(node)
      if (!call || !ctx.expandImport || hidden.has(node)) return node.value
      try {
        return annotateInstance(ctx.expandImport(call), node.id)
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
      // encabezado/párrafo envolvente: la región editable va dentro (el envoltorio se conserva)
      const wrap = node.tag === 'mj-text' ? splitWrapper(node.content) : null
      const inner = wrap ? wrap.inner : node.content
      const open = wrap ? `<${wrap.tag}${wrap.attrs}>` : ''
      const close = wrap ? `</${wrap.tag}>` : ''
      const tagName = node.tag === 'mj-button' || wrap ? 'span' : 'div'
      const m = inner.trim().match(EXACT_T)
      if (m) {
        const msg = lookupMessage(ctx.messages, m[1])
        const missing = msg === undefined || msg === null ? ' data-tpl-missing="1"' : ''
        // en un layout los textos son de cada plantilla: se muestran pero no se editan aquí
        const edit = ctx.kind === 'layout' ? '' : ` data-tpl-edit="t:${escapeHtml(m[1])}"${missing}`
        return `${open}<${tagName}${edit}>${chipify(String(msg ?? '').trim(), ctx)}</${tagName}>${close}`
      }
      return `${open}<${tagName} data-tpl-edit="c:${node.id}">${chipify(inner, ctx)}</${tagName}>${close}`
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

/**
 * Convierte tokens en chips. Con `ctx.params` (al editar un componente), los chips
 * `$param.x` muestran su valor por defecto ya resuelto (con el nombre en el tooltip).
 */
export function chipify(str, ctx = null) {
  return str.replace(CHIP_RE, (src) => {
    let { kind, label } = chipInfo(src)
    let title = src
    if (kind === 'param' && ctx?.params) {
      const value = paramPreview(src.slice(7), ctx)
      if (value) { title = `${src} · por defecto: ${value}`; label = value }
    }
    return `<span class="tpl-chip tpl-chip--${kind}" contenteditable="false" title="${encode(title)}" data-tpl-src="${encode(src)}">${encode(label)}</span>`
  })
}

function paramPreview(name, ctx) {
  const d = normalizeParams(ctx.params)[name]
  if (!d || d.default === '' || d.default == null) return ''
  // resuelve $t/$link/... sin avisos y quita etiquetas HTML para mostrarlo como texto
  const value = resolveCommands(String(d.default), { ...ctx, warnings: [] })
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
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
  if (src.startsWith('$param.')) return { kind: 'param', label: src.slice(7) }
  return { kind: 'cmd', label: src.length > 40 ? `${src.slice(0, 37)}…` : src }
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function encode(s) {
  return String(s).replace(/[&<>"'$%{}#]/g, c => `&#${c.charCodeAt(0)};`)
}
