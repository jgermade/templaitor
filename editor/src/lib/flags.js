// Flag emoji from a locale (es-ES → 🇪🇸). Without a region: null.
const SPECIAL = { 'ca-ES': '🏴󠁥󠁳󠁣󠁴󠁿', 'eu-ES': '🏴', 'gl-ES': '🏴', 'en-GB': '🇬🇧' }

export function flagOf(locale) {
  if (!locale) return null
  if (SPECIAL[locale]) return SPECIAL[locale]
  const region = locale.split('-')[1]
  if (!region || !/^[A-Za-z]{2}$/.test(region)) return null
  return [...region.toUpperCase()].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('')
}
