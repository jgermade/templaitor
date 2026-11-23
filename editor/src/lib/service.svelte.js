// Hosted-service session. In local mode (`templaitor editor`, `make up`) the server has no
// /auth/session route: `mode` stays 'local' and the editor works without login.

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export const svc = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url, body = {}) => request('DELETE', url, body),
}

class Session {
  mode = $state('unknown') // unknown · local · service
  user = $state(null)
  orgs = $state([])
  activeOrg = $state(null)
  appName = $state('templaitor')
  signup = $state('open')

  isService = $derived(this.mode === 'service')
  canEdit = $derived(!this.isService || (['editor', 'admin', 'owner'].includes(this.activeOrg?.role) && !this.activeOrg?.readOnly))
  isAdmin = $derived(['admin', 'owner'].includes(this.activeOrg?.role))

  async load() {
    let data = null
    try {
      const res = await fetch('/auth/session', { headers: { Accept: 'application/json' } })
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) data = await res.json()
    } catch {}
    if (data?.mode !== 'service') { this.mode = 'local'; return }
    this.mode = 'service'
    this.user = data.user
    this.orgs = data.orgs || []
    this.activeOrg = data.activeOrg || null
    this.appName = data.appName || 'templaitor'
    this.signup = data.signup || 'open'
  }

  async switchOrg(id) {
    await svc.post(`/orgs/${id}/activate`)
    location.hash = ''
    location.reload()
  }

  async logout() {
    await svc.post('/auth/logout')
    location.hash = ''
    location.reload()
  }
}

export const session = new Session()
