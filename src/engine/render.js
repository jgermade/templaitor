// Renderizado Jinja2 para la vista previa (nunjucks es compatible con la
// sintaxis Jinja2 habitual: variables, filtros, if/for, etc.)
import nunjucks from 'nunjucks'

const env = new nunjucks.Environment(null, { autoescape: true, throwOnUndefined: false })

export function renderJinja(template, data = {}) {
  return env.renderString(template, data)
}

export function tryRenderJinja(template, data, warnings) {
  try {
    return renderJinja(template, data)
  } catch (err) {
    warnings?.push(`Jinja2: ${String(err.message).split('\n').pop().trim()}`)
    return template
  }
}
