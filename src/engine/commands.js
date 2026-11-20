// Resolución recursiva de comandos $ (compile-time)
//
//   $lang · $country · $t('key') · $link{ name, label: ..., title: ... }
//   $if( expr ) ... $else ... $end
//
// ctx: { lang, country, messages, links, warnings: [] }

const MAX_PASSES = 25

export function resolveCommands(content, ctx) {
  let prev = null
  let result = content
  let passes = 0
  while (prev !== result) {
    if (++passes > MAX_PASSES) {
      warn(ctx, 'Demasiadas pasadas resolviendo comandos $ (¿referencia circular en $t?)')
      break
    }
    prev = result
    result = applyPass(result, ctx)
  }
  return result
}

function applyPass(content, ctx) {
  // $if primero: sus expresiones usan $lang/$country como literales JS
  content = resolveIf(content, ctx)
  content = content.replace(/\$lang\b/g, ctx.lang)
  content = content.replace(/\$country\b/g, ctx.country)
  content = resolveT(content, ctx)
  content = resolveLink(content, ctx)
  return content
}

export function lookupMessage(messages, key) {
  if (!messages) return undefined
  if (key in messages) return messages[key]
  // soporte de claves anidadas: $t('footer.legal')
  return key.split('.').reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), messages)
}

function resolveT(content, ctx) {
  return content.replace(/\$t\(\s*['"]([^'"]+)['"]\s*\)/g, (_, key) => {
    const value = lookupMessage(ctx.messages, key)
    if (value === undefined || value === null) {
      warn(ctx, `$t('${key}') no encontrado para el locale ${ctx.lang}`)
      return ''
    }
    return String(value).trim()
  })
}

function resolveLink(content, ctx) {
  return content.replace(/\$link\{\s*([\w.-]+)\s*(?:,([^}]*))?\}/g, (_, name, attrs = '') => {
    const url = ctx.links?.[name]
    if (!url) {
      warn(ctx, `$link: '${name}' no existe en links.yml`)
      return ''
    }
    const { label = name, title } = parseAttrs(attrs)
    const titleAttr = title ? ` title="${title}"` : ''
    return `<a href="${url}"${titleAttr}>${label}</a>`
  })
}

function resolveIf(content, ctx) {
  return content.replace(/\$if\(([^)]+)\)([\s\S]*?)\$end\b/g, (_, expr, body) => {
    const [ifBody, elseBody = ''] = body.split('$else')
    const safeExpr = expr
      .replace(/\$lang\b/g, JSON.stringify(ctx.lang))
      .replace(/\$country\b/g, JSON.stringify(ctx.country))
    try {
      // Las plantillas son código de confianza del proyecto (compile-time)
      const result = new Function(`return (${safeExpr})`)()
      return result ? ifBody : elseBody
    } catch (err) {
      warn(ctx, `$if(${expr}): ${err.message}`)
      return ''
    }
  })
}

export function parseAttrs(str) {
  const result = {}
  for (const part of str.split(',')) {
    const colonIdx = part.indexOf(':')
    if (colonIdx === -1) continue
    const key = part.slice(0, colonIdx).trim()
    const val = part.slice(colonIdx + 1).trim()
    if (key) result[key] = val
  }
  return result
}

function warn(ctx, msg) {
  if (ctx.warnings) {
    if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg)
  } else {
    console.warn(`  [warn] ${msg}`)
  }
}
