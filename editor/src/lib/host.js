// URLs the editor builds outside the JSON API. A host page can override them through
// `globalThis.__TEMPLAITOR_HOST__` (the in-browser demo, editor/demo, has no /preview/ or /static/ routes).
const host = () => globalThis.__TEMPLAITOR_HOST__ || {}

// Both are relative to the editor page, so the editor also works mounted under a sub-path (e.g. `/templaitor/`).

/** Shareable preview page of a saved document (`path`: URL-encoded id, `params`: URLSearchParams) */
export const previewUrl = (path, params) => host().previewUrl?.(path, params) ?? new URL(`preview/${path}?${params}`, location.href).href

/** URL of an image of the project's static folder (`path` relative to it) */
export const staticUrl = (path) => host().staticUrl?.(path) ?? `static/${path}`
