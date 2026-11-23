// Flag of a locale as an SVG (es-ES → Spain), loaded on demand: each country is a separate small file.
// Regions without a country flag (Catalan, Basque, Galician) have their own SVG. Without a region: null.
const COUNTRIES = Object.fromEntries(Object.entries(import.meta.glob('@flags/*.svg', { query: '?url', import: 'default' }))
  .map(([file, load]) => [file.split('/').pop().replace(/\.svg$/, ''), load]))

const svg = (body) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">${body}</svg>`)}`
const SPECIAL = {
  // senyera
  'ca-ES': svg('<rect width="30" height="20" fill="#FCDD09"/><path d="M0 3.3h30M0 7.8h30M0 12.2h30M0 16.7h30" stroke="#DA121A" stroke-width="2.2"/>'),
  // ikurriña
  'eu-ES': svg('<rect width="30" height="20" fill="#D52B1E"/><path d="M0 0l30 20M30 0 0 20" stroke="#009B48" stroke-width="3"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="3"/>'),
  // Galicia
  'gl-ES': svg('<rect width="30" height="20" fill="#fff"/><path d="M0 0l30 20" stroke="#0099CC" stroke-width="4"/>'),
}

export function regionOf(locale) {
  const region = String(locale || '').split('-')[1]
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null
}

/** URL of the flag of a locale (Promise) or null */
export async function flagUrl(locale) {
  if (SPECIAL[locale]) return SPECIAL[locale]
  const region = regionOf(locale)
  const load = region && COUNTRIES[region]
  return load ? load() : null
}
