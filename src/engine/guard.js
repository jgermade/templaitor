// Protects Jinja2 tokens ({{ }}, {% %}, {# #}) from the MJML (XML) compiler

const JINJA_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g

export function obfuscate(content) {
  const map = []
  const result = content.replace(JINJA_RE, (match) => {
    const idx = map.length
    map.push(match)
    return `__J2_${idx}__`
  })
  return { content: result, map }
}

export function restore(content, map) {
  return content.replace(/__J2_(\d+)__/g, (_, idx) => map[Number(idx)])
}
