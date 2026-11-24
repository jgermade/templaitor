// The editor's backend running in the browser: the real engine (src/engine) over a virtual file system kept
// in IndexedDB, answering the editor's `fetch('/api/…')` calls. Nothing leaves the browser.
//
// PDFs cannot be rendered in the browser (WeasyPrint, Prince, Chromium and veraPDF are programs): the site
// build pre-generates the starter's PDFs and attachments (scripts/build-demo-pdfs.mjs → pdfs/manifest.json)
// and they are served from there. Sending email (SMTP) and remote attachments answer with a clear error.
import { vfs } from './shims/fs.js'
import { loadVfs, resetVfs } from './vfs.js'
import { demoVersionStore } from './versions.js'
import { loadProject, listTemplates, listComponents, listMjmlFiles, saveAsset } from '../../src/engine/project.js'
import { saveVersion } from '../../src/engine/versions.js'
import { previewDraft } from '../../src/engine/pipeline.js'
import { createRoutes, previewPage } from '../../src/server/server.js'

const ROOT = '/demo'
const SEED_VERSION = 1 // bump when the bundled starter project changes incompatibly
const NEEDS_SERVER = 'needs a server: run the editor locally (npx templaitor editor) or use the hosted service'

// the starter project (examples/demo), bundled as text
// pre-generated PDFs, next to the demo page
const PDF_BASE = new URL('pdfs/', location.href.split(/[?#]/)[0])

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

async function draftHash(d) {
  const bytes = new TextEncoder().encode(JSON.stringify([d.mjml ?? '', d.yml ?? '', d.data ?? '']))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Serves the pre-generated PDFs (`pdfs`: the manifest, or null when the site was built without them) */
function pdfServer(pdfs, realFetch, project) {
  const unavailable = (what) => fail(501, `${what} ${NEEDS_SERVER}${pdfs ? '' : ' (this build has no pre-generated PDFs)'}`)
  const file = async (rel, type) => {
    const res = await realFetch(new URL(rel, PDF_BASE))
    if (!res.ok) throw fail(501, `Pre-generated file missing: ${rel}`)
    return new Blob([await res.arrayBuffer()], { type })
  }

  /** The pre-generated document for a draft → { doc, entry, exact } */
  async function documentFor(body) {
    if (!pdfs) throw unavailable('PDF rendering')
    const hash = await draftHash(body)
    const docs = Object.values(pdfs.documents)
    const doc = docs.find(d => d.hash === hash)
      ?? docs.find(d => d.name === body.name)
      ?? (body.kind === 'layout' ? docs[0] : null) // a PDF layout is previewed with a PDF template
    if (!doc) throw unavailable(`PDF rendering of ${body.name || 'this document'}`)
    const entry = doc.langs[body.lang] ?? Object.values(doc.langs)[0]
    return { doc, entry, exact: doc.hash === hash && !!doc.langs[body.lang] }
  }

  return {
    async pdf(body) {
      const { entry, exact } = await documentFor(body)
      const label = pdfs.engineLabel
      const note = exact
        ? `Pre-generated with ${label} when the site was built: the browser cannot render PDFs.`
        : `The starter's PDF, pre-generated with ${label}: your edits are not in it. Rendering PDFs ${NEEDS_SERVER}.`
      return new Response(await file(entry.file, 'application/pdf'), {
        headers: { 'Content-Type': 'application/pdf', 'X-Templaitor-Engine': entry.engine, 'X-Templaitor-Note': encodeURIComponent(note) },
      })
    },

    async validate(body) {
      const { entry, exact } = await documentFor(body)
      if (!entry.validation || entry.validation.error) throw unavailable('veraPDF validation')
      if (!exact) throw fail(501, `Only the starter's unchanged PDFs were validated when the site was built: validating your edits ${NEEDS_SERVER}`)
      return json({ engine: entry.engine, locale: entry.locale, validation: entry.validation })
    },

    async attachment(body) {
      if (!pdfs) throw unavailable('Rendering attachments')
      const index = Number(body.index ?? 0)
      const hash = await draftHash(body)
      const forLang = (e) => e?.langs[body.lang] ?? Object.values(e?.langs ?? {})[0] ?? []
      let att = forLang(Object.values(pdfs.attachments).find(e => e.hash === hash)).find(a => a.index === index)
      if (!att) {
        // edited email: the same document attached in the same language, if it was pre-generated
        const { attachments = [] } = await previewDraft(project, { mjml: body.mjml, yml: body.yml, data: body.data, langKey: body.lang })
        const want = attachments.find(a => a.index === index)
        att = want?.type === 'template' && Object.values(pdfs.attachments).flatMap(e => Object.values(e.langs).flat())
          .find(a => a.template === want.template && a.locale === want.locale)
      }
      if (!att) throw unavailable('Rendering this attachment')
      return new Response(await file(att.file, att.contentType), {
        headers: { 'Content-Type': att.contentType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}` },
      })
    },
  }
}

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
  const pdfs = await realFetch(new URL('manifest.json', PDF_BASE)).then(r => (r.ok ? r.json() : null)).catch(() => null)
  const pdfServe = pdfServer(pdfs, realFetch, project)

  async function handle(url, method, init, request) {
    const p = url.pathname
    if (p === '/auth/session') return json({ error: 'Route not found' }, 404) // local mode: no sign-in
    if (p === '/api/assets' && method === 'POST') {
      const body = init?.body ?? (request ? await request.clone().blob() : null)
      const buf = new Uint8Array(await body.arrayBuffer())
      if (buf.length > 5 * 1024 * 1024) throw fail(413, 'The image is larger than 5 MB')
      return json(saveAsset(project, url.searchParams.get('name'), buf))
    }
    if (p === '/api/pdf' && method === 'POST') return pdfServe.pdf(await bodyOf(init, request))
    if (p === '/api/pdf/validate' && method === 'POST') return pdfServe.validate(await bodyOf(init, request))
    if (p === '/api/attachment' && method === 'POST') return pdfServe.attachment(await bodyOf(init, request))
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
    return json(p === '/api/preview' || p === '/api/project' ? deepInline(project, p === '/api/project' ? demoProjectInfo(out, pdfs) : out) : out)
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

/** `GET /api/project` without the server-only features: the PDF engine is the one the PDFs were made with */
function demoProjectInfo(info, pdfs) {
  const engine = pdfs?.engine ?? null
  return {
    ...info, demo: true, smtp: null,
    pdf: {
      ...info.pdf,
      engines: info.pdf.engines.map(e => ({ ...e, available: e.id === engine })),
      defaultEngine: engine, configured: engine ? 'pre-generated' : 'none',
      verapdf: pdfs?.validator ? `${pdfs.validator} (pre-computed)` : null,
    },
  }
}
