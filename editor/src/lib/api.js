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
  create: (id, layout) => request('POST', '/api/templates', { id, layout }),
  createComponent: (comp) => request('POST', '/api/components', comp),
  remove: (id, kind = 'template') => request('DELETE', `/api/template?${q({ id, kind })}`),
  preview: (draft) => request('POST', '/api/preview', draft),
  compile: (id) => request('POST', '/api/compile', { id }),
  send: (draft) => request('POST', '/api/send', draft),
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
