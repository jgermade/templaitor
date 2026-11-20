// Text semantics (accessibility): an mj-text can be a paragraph or a heading.
// The heading wraps the content and inherits the visual style of the mj-text:
//
//   <mj-text font-size="20px" font-weight="600"><h1 style="margin:0;font:inherit;color:inherit">$t('title')</h1></mj-text>

export const HEADING_STYLE = 'margin:0;font:inherit;color:inherit;letter-spacing:inherit'

const WRAP = /^\s*<(h[1-6]|p)(\s[^>]*)?>([\s\S]*)<\/\1>\s*$/i

/** { tag, attrs, inner } when the content is wrapped in a single <hN>/<p> */
export function splitWrapper(content) {
  const m = String(content ?? '').match(WRAP)
  if (!m || /<\/?(h[1-6]|p|div|table)\b/i.test(m[3])) return null
  return { tag: m[1].toLowerCase(), attrs: m[2] || '', inner: m[3].trim() }
}

export function headingLevel(content) {
  const w = splitWrapper(content)
  return w && w.tag[0] === 'h' ? Number(w.tag[1]) : 0
}

/** Changes the level (0 = paragraph) keeping the inner content */
export function setHeadingLevel(content, level) {
  const w = splitWrapper(content)
  const inner = w ? w.inner : String(content ?? '').trim()
  if (!level) return inner
  const attrs = w && w.tag[0] === 'h' && w.attrs ? w.attrs : ` style="${HEADING_STYLE}"`
  return `<h${level}${attrs}>${inner}</h${level}>`
}

/** Re-wraps edited inner content with the same wrapper `original` had */
export function rewrap(original, inner) {
  const w = splitWrapper(original)
  return w ? `<${w.tag}${w.attrs}>${inner}</${w.tag}>` : inner
}
