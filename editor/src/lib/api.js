async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

const q = (params) => new URLSearchParams(params).toString()

export const api = {
  project: () => request('GET', '/api/project'),
  templates: () => request('GET', '/api/templates'),
  components: () => request('GET', '/api/components'),
  layouts: () => request('GET', '/api/layouts'),
  createLayout: (id) => request('POST', '/api/layouts', { id }),
  template: (id, kind = 'template') => request('GET', `/api/template?${q({ id, kind })}`),
  save: (doc) => request('PUT', '/api/template', doc),
  create: (id, layout, format) => request('POST', '/api/templates', { id, layout, format }),
  createComponent: (comp) => request('POST', '/api/components', comp),
  remove: (id, kind = 'template') => request('DELETE', `/api/template?${q({ id, kind })}`),
  preview: (draft) => request('POST', '/api/preview', draft),
  compile: (id) => request('POST', '/api/compile', { id }),
  send: (draft) => request('POST', '/api/send', draft),
  pdf: async (draft) => {
    const res = await fetch('/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    return { blob: await res.blob(), engine: res.headers.get('X-Templaitor-Engine') }
  },
  /** One attachment of the draft rendered with the demo data → Blob */
  attachment: async (draft, index) => {
    const res = await fetch('/api/attachment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, index }) })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    return res.blob()
  },
  validatePdf: (draft) => request('POST', '/api/pdf/validate', draft),
  /** Compare mode: git commits of a document and the document at a commit */
  history: (id, kind = 'template') => request('GET', `/api/history?${q({ id, kind })}`),
  version: (id, kind, rev) => request('GET', `/api/version?${q({ id, kind, rev })}`),
  assets: () => request('GET', '/api/assets'),
  uploadAsset: async (file) => {
    const res = await fetch(`/api/assets?${q({ name: file.name })}`, { method: 'POST', body: file })
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`)
    return data
  },
  file: (path) => request('GET', `/api/file?${q({ path })}`),
  saveFile: (path, content) => request('PUT', '/api/file', { path, content }),
}
