// The editor's backend running in the browser: the real engine (src/engine) over a virtual file system kept
// in IndexedDB, answering the editor's `fetch('/api/…')` calls. Nothing leaves the browser.
//
// What needs a server is answered with a clear error: PDF rendering and validation (WeasyPrint, Prince,
// Chromium, veraPDF are programs), sending email (SMTP) and remote attachments.
import { vfs } from './shims/fs.js'
import { loadVfs, resetVfs } from './vfs.js'
import { demoVersionStore } from './versions.js'
import { loadProject, listTemplates, listComponents, listMjmlFiles, saveAsset } from '../../src/engine/project.js'
import { saveVersion } from '../../src/engine/versions.js'
import { createRoutes, previewPage } from '../../src/server/server.js'

const ROOT = '/demo'
const SEED_VERSION = 1 // bump when the bundled starter project changes incompatibly
const NEEDS_SERVER = 'needs a server: run the editor locally (npx templaitor editor) or use the hosted service'

// the starter project (examples/demo), bundled as text
const seed = import.meta.glob('../../examples/demo/**/*', { query: '?raw', import: 'default', eager: true })

function writeSeed() {
  vfs.clear()
  for (const [file, content] of Object.entries(seed)) {
    const rel = file.replace(/^.*\/examples\/demo\//, '')
    const p = `${ROOT}/${rel}`
    const dir = p.slice(0, p.lastIndexOf('/'))
    if (!vfs.dirs.has(dir)) for (let d = dir; d && !vfs.dirs.has(d); d = d.slice(0, d.lastIndexOf('/')) || '/') vfs.dirs.add(d)
    vfs.files.set(p, content)
  }
  vfs.dirs.add(ROOT)
  vfs.files.set(`${ROOT}/.templaitor/demo-seed`, String(SEED_VERSION))
  vfs.dirs.add(`${ROOT}/.templaitor`)
  // persist everything that was just written
  for (const p of [...vfs.dirs, ...vfs.files.keys()]) vfs.onChange(p)
}

function openProject() {
  // no SMTP in the browser: the "send a test" button is hidden
  const project = loadProject(ROOT, { smtp: null })
  project.versionStore = demoVersionStore(project)
  return project
}

/** Every document of a fresh demo starts with a first version, so versions and compare can be tried at once */
async function seedVersions(project) {
  const author = { name: 'templaitor', email: 'demo@templaitor.local' }
  const docs = [
    ...listTemplates(project).map(t => ['template', t.id]),
    ...listComponents(project).map(c => ['component', c.id]),
    ...listMjmlFiles(project.layoutsDir).map(f => ['layout', f]),
  ]
  for (const [kind, id] of docs) await saveVersion(project, id, kind, { message: 'Initial version', author }).catch(() => {})
}

// ── /static/ images as data: URLs (the canvas iframe is sandboxed and there is no /static/ route) ──

const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

function dataUrl(project, rel) {
  const p = `${project.staticDir}/${decodeURIComponent(rel)}`.replace(/\/+/g, '/')
  const v = vfs.files.get(p)
  if (v == null) return null
  const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream'};base64,${btoa(bin)}`
}

const inlineStatic = (project, html) => String(html).replace(/(^|["'(\s,=])\/static\/([^"')\s?#,]+)/g, (m, pre, rel) => {
  const url = dataUrl(project, rel)
  return url ? pre + url : m
})

const deepInline = (project, v) => {
  if (typeof v === 'string') return v.includes('/static/') ? inlineStatic(project, v) : v
  if (Array.isArray(v)) return v.map(x => deepInline(project, x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepInline(project, x)]))
  return v
}

// ── fetch interception ──

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
const fail = (status, message) => Object.assign(new Error(message), { status })

async function bodyOf(init, request) {
  const raw = init?.body ?? (request ? await request.clone().text() : undefined)
  if (raw == null || raw === '') return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { throw fail(400, 'Invalid JSON') }
  }
  return raw
}

export async function startBackend() {
  const restored = await loadVfs()
  const fresh = !restored || vfs.files.get(`${ROOT}/.templaitor/demo-seed`) !== String(SEED_VERSION)
  if (fresh) writeSeed()
  let project = openProject()
  if (fresh) await seedVersions(project)
  let routes = createRoutes(project)

  const realFetch = globalThis.fetch.bind(globalThis)

  async function handle(url, method, init, request) {
    const p = url.pathname
    if (p === '/auth/session') return json({ error: 'Route not found' }, 404) // local mode: no sign-in
    if (p === '/api/assets' && method === 'POST') {
      const body = init?.body ?? (request ? await request.clone().blob() : null)
      const buf = new Uint8Array(await body.arrayBuffer())
      if (buf.length > 5 * 1024 * 1024) throw fail(413, 'The image is larger than 5 MB')
      return json(saveAsset(project, url.searchParams.get('name'), buf))
    }
    if (p === '/api/pdf' || p === '/api/pdf/validate') throw fail(501, `PDF rendering ${NEEDS_SERVER}. The Design and Preview views show the document as HTML.`)
    if (p === '/api/attachment') throw fail(501, `Rendering attachments ${NEEDS_SERVER}`)
    if (p === '/api/send') throw fail(501, `Sending email ${NEEDS_SERVER}`)
    if (p === '/api/demo/reset' && method === 'POST') {
      await resetVfs()
      writeSeed()
      project = openProject()
      await seedVersions(project)
      routes = createRoutes(project)
      return json({ ok: true })
    }
    const route = routes[`${method} ${p}`]
    if (!route) throw fail(404, 'Route not found')
    const body = ['POST', 'PUT'].includes(method) ? await bodyOf(init, request) : null
    const out = await route({ query: url.searchParams, body, req: { templaitorActor: { name: 'You', email: 'demo@templaitor.local' } } })
    return json(p === '/api/preview' || p === '/api/project' ? deepInline(project, p === '/api/project' ? demoProjectInfo(out) : out) : out)
  }

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input), location.href)
    if (url.origin !== location.origin || !/^\/(api|auth)\//.test(url.pathname)) return realFetch(input, init)
    const method = String(init?.method || request?.method || 'GET').toUpperCase()
    try {
      return await handle(url, method, init, request)
    } catch (err) {
      if (!err.status) console.error(err)
      return json({ error: err.message }, err.status || 500)
    }
  }

  return {
    get project() { return project },
    /** Rendered preview page of a saved document (`?preview=<id>&lang=…&kind=…&version=…`) */
    async previewHtml(search) {
      const q = new URLSearchParams(search)
      const id = q.get('preview')
      q.delete('preview')
      const url = new URL(`http://demo/preview/${id.split('/').map(encodeURIComponent).join('/')}?${q}`)
      let html = ''
      let status = 200
      await previewPage(project, url, { writeHead: (s) => { status = s }, end: (s) => { html = String(s ?? '') } })
      return { status, html: inlineStatic(project, html.replace('<base href="/">', '')) }
    },
    staticUrl: (rel) => dataUrl(project, rel) ?? '',
  }
}

/** `GET /api/project` without the server-only features (PDF engines and veraPDF are programs) */
function demoProjectInfo(info) {
  return { ...info, demo: true, smtp: null, pdf: { ...info.pdf, engines: info.pdf.engines.map(e => ({ ...e, available: false })), defaultEngine: null, verapdf: null } }
}
