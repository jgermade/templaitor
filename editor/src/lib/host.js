// URLs the editor builds outside the JSON API. A host page can override them through
// `globalThis.__TEMPLAITOR_HOST__` (the in-browser demo, editor/demo, has no /preview/ or /static/ routes).
const host = () => globalThis.__TEMPLAITOR_HOST__ || {}

/** Shareable preview page of a saved document (`path`: URL-encoded id, `params`: URLSearchParams) */
export const previewUrl = (path, params) => host().previewUrl?.(path, params) ?? `${location.origin}/preview/${path}?${params}`

/** URL of an image of the project's static folder (`path` relative to it) */
export const staticUrl = (path) => host().staticUrl?.(path) ?? `/static/${path}`
