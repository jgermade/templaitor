// Editor server: JSON API + static files of the SPA (dist/editor)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import JSON5 from 'json5'
import {
  listTemplates, readTemplate, writeTemplate, createTemplate, deleteTemplate,
  listMjmlFiles, resolveAuxFile, httpError, listComponents, createComponent, listAssets, saveAsset,
  listLayouts, readLayout, writeLayout, createLayout, deleteLayout,
} from '../engine/project.js'
import { previewDraft, compileProject, compileSource, langsOf, renderDraftPdf, validateDraftPdf, renderDraftAttachments } from '../engine/pipeline.js'
import { listEngines, resolveEngine } from '../engine/pdf.js'
import { verapdfRunner } from '../engine/verapdf.js'
import { readLinks } from '../engine/project.js'
import { renderJinja } from '../engine/render.js'
import { listVersions, readVersion, saveVersion, initVersions, resolveVersion } from '../engine/versions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDITOR_DIST = path.resolve(__dirname, '../../dist/editor')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
}

/**
 * JSON routes of the editor API → { 'METHOD /api/path': ({ query, body, req }) => result }.
 * Shared by the HTTP handler below and the in-browser demo backend (editor/demo).
 */
export function createRoutes(project) {
  return {
    'GET /api/project': () => ({
      name: project.name,
      locales: project.locales,
      defaultLocale: project.defaultLocale,
      templatesDir: path.relative(project.cwd, project.templatesDir),
      outDir: path.relative(project.cwd, project.outDir),
      layouts: listMjmlFiles(project.layoutsDir),
      files: [
        ...listMjmlFiles(project.layoutsDir).map(f => rel(project, path.join(project.layoutsDir, f))),
        ...listMjmlFiles(project.partialsDir).map(f => rel(project, path.join(project.partialsDir, f))),
        ...(fs.existsSync(project.linksFile) ? [rel(project, project.linksFile)] : []),
      ],
      links: readLinks(project),
      smtp: project.smtp ? { label: project.smtp.label || 'Send', web: project.smtp.web || null } : null,
      componentsDir: rel(project, project.componentsDir),
      assetsUrl: project.assetsUrl,
      pdf: pdfInfo(project),
    }),

    'GET /api/templates': () => listTemplates(project),

    'GET /api/components': () => listComponents(project),

    // images from the static directory (served at /static/)
    'GET /api/assets': () => listAssets(project),

    'GET /api/layouts': () => listLayouts(project),

    // PDF/UA-1 validation (veraPDF) of the draft's PDF
    'POST /api/pdf/validate': ({ body }) => validateDraftPdf(project, {
      mjml: body.mjml, yml: body.yml, data: body.data, langKey: body.lang, kind: previewKind(body.kind),
    }, { engine: body.engine }),

    'POST /api/layouts': ({ body }) => createLayout(project, body.id, { format: body.format === 'pdf' ? 'pdf' : 'email' }),

    // versions of a document (git commits, or the database in the hosted service): list, read, save, init.
    // `req.templaitorActor` (hosted service) is the signed-in user, recorded as the author.
    'GET /api/versions': ({ query }) => listVersions(project, query.get('id'), docKind(query.get('kind')), { limit: query.get('limit') }),
    'GET /api/version': ({ query }) => readVersion(project, query.get('id'), docKind(query.get('kind')), query.get('rev')),
    'POST /api/versions': ({ body, req }) => saveVersion(project, body.id, docKind(body.kind), { message: body.message, author: req.templaitorActor }),
    'POST /api/versions/init': ({ req }) => initVersions(project, { author: req.templaitorActor }),

    // `kind`: 'template' (default) | 'component' | 'layout'
    'GET /api/template': ({ query }) => (query.get('kind') === 'layout'
      ? readLayout(project, query.get('id'))
      : readTemplate(project, query.get('id'), kindOf(query.get('kind')))),

    'PUT /api/template': ({ body }) => {
      // only the MJML of a layout is saved (texts and data belong to the preview template)
      if (body.kind === 'layout') return writeLayout(project, body.id, body)
      validateDraft(body)
      return writeTemplate(project, body.id, body, kindOf(body.kind))
    },

    'POST /api/templates': ({ body }) => createTemplate(project, body.id, { layout: body.layout, langs: body.langs, format: body.format }),

    'POST /api/components': ({ body }) => {
      if (body.yml) validateDraft({ id: body.id, yml: body.yml })
      return createComponent(project, body.id, {
        mjml: body.mjml,
        messages: body.yml ? YAML.parse(body.yml)?.messages : undefined,
        data: body.data ? JSON5.parse(body.data) : undefined,
      })
    },

    'DELETE /api/template': ({ query }) => {
      if (query.get('kind') === 'layout') { deleteLayout(project, query.get('id')); return { ok: true } }
      deleteTemplate(project, query.get('id'), kindOf(query.get('kind')))
      return { ok: true }
    },

    'POST /api/preview': ({ body }) => previewDraft(project, {
      mjml: body.mjml, yml: body.yml, data: body.data, langKey: body.lang, mode: body.mode, kind: previewKind(body.kind),
    }),

    'POST /api/compile': async ({ body }) => {
      const r = await compileProject(project, { target: body?.id, log: null, samplePdf: !!body?.samplePdf })
      return { files: r.files.map(f => path.relative(project.cwd, f)), issues: r.issues }
    },

    'GET /api/file': ({ query }) => {
      const file = resolveAuxFile(project, query.get('path'))
      if (!fs.existsSync(file)) throw httpError(404, 'No existe')
      return { path: query.get('path'), content: fs.readFileSync(file, 'utf8') }
    },

    'PUT /api/file': ({ body }) => {
      const file = resolveAuxFile(project, body.path)
      if (/\.ya?ml$/.test(file)) YAML.parse(body.content)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, body.content)
      return { ok: true }
    },

    'POST /api/send': async ({ body }) => {
      if (!project.smtp) throw httpError(400, 'SMTP is not configured (add `smtp` to templaitor.config.yml)')
      const { default: nodemailer } = await import('nodemailer')
      const i18n = YAML.parse(body.yml || '') || {}
      const data = JSON5.parse(body.data || '{}')
      const lang = body.lang || langsOf(project, i18n)[0]
      const r = await compileSource(project, { mjml: body.mjml, i18n, links: readLinks(project), langKey: lang, kind: kindOf(body.kind) })
      // attachments: local PDF templates rendered in this language, remote files downloaded
      const attachments = r.attachments.length
        ? await renderDraftAttachments(project, { mjml: body.mjml, yml: body.yml, langKey: lang }, { values: data })
        : []
      const transport = nodemailer.createTransport({
        host: project.smtp.host || 'localhost',
        port: Number(project.smtp.port || 1025),
        secure: !!project.smtp.secure,
        ...(project.smtp.user ? { auth: { user: project.smtp.user, pass: project.smtp.pass ?? process.env[project.smtp.passEnv || 'SMTP_PASS'] } } : {}),
      })
      const info = await transport.sendMail({
        from: project.smtp.from || 'templaitor@localhost',
        to: body.to,
        subject: renderJinja(r.subject, data),
        html: renderJinja(r.html, data),
        text: renderJinja(r.text, data),
        attachments: attachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      }).catch((err) => {
        const where = `${project.smtp.host || 'localhost'}:${project.smtp.port || 1025}`
        throw httpError(502, /ECONNREFUSED/.test(`${err.code} ${err.message}`) ? `No SMTP server at ${where} (is Mailpit running? make up)` : err.message)
      })
      return { ok: true, messageId: info.messageId, attachments: attachments.map(a => a.filename) }
    },
  }
}

export function createHandler(project) {
  const routes = createRoutes(project)

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname === '/api/assets' && req.method === 'POST') {
        // image upload: binary body, name in ?name=
        return sendJson(res, saveAsset(project, url.searchParams.get('name'), await readRaw(req, 5 * 1024 * 1024 + 1)))
      }
      if (url.pathname === '/api/pdf' && req.method === 'POST') {
        // PDF of the draft with the demo data
        const body = await readJson(req)
        const { pdf, result, engine } = await renderDraftPdf(project, {
          mjml: body.mjml, yml: body.yml, data: body.data, langKey: body.lang, kind: previewKind(body.kind),
        }, { engine: body.engine })
        res.writeHead(200, {
          'X-Templaitor-Engine': engine,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${encodeURIComponent(body.name || 'documento')}.${result.locale}.pdf"`,
          'X-Templaitor-Warnings': encodeURIComponent(JSON.stringify(result.warnings || [])),
        })
        return res.end(pdf)
      }
      if (url.pathname === '/api/attachment' && req.method === 'POST') {
        // one attachment of the draft rendered with the demo data (local PDF or downloaded remote file)
        const body = await readJson(req)
        const [att] = await renderDraftAttachments(project, {
          mjml: body.mjml, yml: body.yml, data: body.data, langKey: body.lang,
        }, { index: body.index ?? 0 })
        res.writeHead(200, {
          'Content-Type': att.contentType,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
        })
        return res.end(att.content)
      }
      if (url.pathname.startsWith('/preview/') && req.method === 'GET') {
        // shareable preview: the saved document (or a version) rendered with its demo data, at a real URL
        return await previewPage(project, url, res)
      }
      if (url.pathname.startsWith('/api/')) {
        const route = routes[`${req.method} ${url.pathname}`]
        if (!route) throw httpError(404, 'Route not found')
        const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : null
        return sendJson(res, await route({ query: url.searchParams, body, req }))
      }
      if (url.pathname.startsWith('/static/')) {
        return serveFile(res, project.staticDir, url.pathname.slice('/static/'.length))
      }
      return serveFile(res, EDITOR_DIST, url.pathname === '/' ? 'index.html' : url.pathname.slice(1), true)
    } catch (err) {
      if (!err.status) console.error(err)
      sendJson(res, { error: err.message }, err.status || 500)
    }
  }
}

export function startServer(project, { port = 3333, host = '127.0.0.1', open = false } = {}) {
  const server = http.createServer(createHandler(project))
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
      console.log(`\n✎ templaitor · ${project.name} → ${url}\n`)
      if (!fs.existsSync(EDITOR_DIST)) console.log('  (warning) dist/editor does not exist: run `npm run build` or use `npm run dev`\n')
      if (open) import('node:child_process').then(({ exec }) => exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`))
      resolve(server)
    })
  })
}

// ── helpers ───────────────────────────────────────────────────

/**
 * GET /preview/<id>?lang=es|es-ES&kind=template|component|layout&version=v3
 * The saved files (or a version) rendered with the demo data, as a normal page: it can be reloaded,
 * bookmarked and shared with whoever can open the editor.
 */
export async function previewPage(project, url, res) {
  const q = url.searchParams
  const kind = docKind(q.get('kind'))
  const id = url.pathname.slice('/preview/'.length).split('/').map(decodeURIComponent).join('/').replace(/\/+$/, '')
  try {
    let doc = kind === 'layout' ? readLayout(project, id) : readTemplate(project, id, kindOf(kind))
    let version = null
    if (q.get('version')) {
      const v = await resolveVersion(project, doc.id, kind, q.get('version'))
      version = v.number ? `v${v.number}` : v.short
      doc = { ...doc, mjml: v.mjml, ...(kind === 'layout' ? {} : { yml: v.yml ?? '', data: v.data ?? doc.data }) }
    }
    let langs = []
    try { langs = Object.keys(YAML.parse(doc.yml || '')?.messages || {}) } catch {}
    const want = String(q.get('lang') || '').toLowerCase()
    const lang = langs.find(l => l.toLowerCase() === want)
      ?? langs.find(l => String(project.locales[l] || '').toLowerCase() === want)
      ?? langs.find(l => l.toLowerCase() === want.split(/[-_]/)[0])
    if (want && !lang && langs.length) throw httpError(404, `Language not available: ${q.get('lang')} (available: ${langs.join(', ')})`)
    const r = await previewDraft(project, { mjml: doc.mjml, yml: doc.yml, data: doc.data, langKey: lang, mode: 'preview', kind })
    const title = `${r.subject || doc.name || id}${version ? ` · ${version}` : ''}`
    // relative URLs (static images) resolve from the server root, as in the editor
    const html = /<head(\s[^>]*)?>/i.test(r.html)
      ? r.html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="/"><title>${escapeHtml(title)}</title>`)
      : `<!doctype html><html><head><base href="/"><title>${escapeHtml(title)}</title></head><body>${r.html}</body></html>`
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html)
  } catch (err) {
    if (!err.status) console.error(err)
    res.writeHead(err.status || 500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview not available</title></head>
<body style="font: 15px/1.5 system-ui, sans-serif; margin: 40px; color: #18181b"><h1 style="font-size: 18px">Preview not available</h1><p>${escapeHtml(err.message)}</p></body></html>`)
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function pdfInfo(project) {
  const engines = listEngines()
  let defaultEngine = null
  try { defaultEngine = resolveEngine(project.config.pdf?.engine) } catch {}
  const v = verapdfRunner()
  return { engines, defaultEngine, configured: project.config.pdf?.engine || 'auto', verapdf: v ? v.label : null }
}

const kindOf = (k) => (k === 'component' ? 'component' : 'template')
const docKind = (k) => (['component', 'layout'].includes(k) ? k : 'template')
const previewKind = (k) => (['component', 'layout'].includes(k) ? k : 'template')

function rel(project, file) {
  return path.relative(project.templatesDir, file).split(path.sep).join('/')
}

function validateDraft(body) {
  if (!body?.id) throw httpError(400, 'Missing id')
  if (body.yml) {
    try { YAML.parse(body.yml) } catch (e) { throw httpError(400, `Invalid YAML: ${e.message.split('\n')[0]}`) }
  }
  if (body.data) {
    try { JSON5.parse(body.data) } catch (e) { throw httpError(400, `Invalid JSON5: ${e.message}`) }
  }
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(httpError(413, 'The image is larger than 5 MB')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c; if (data.length > 5e6) reject(httpError(413, 'Payload too large')) })
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch { reject(httpError(400, 'Invalid JSON')) } })
    req.on('error', reject)
  })
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function serveFile(res, rootDir, relPath, spaFallback = false) {
  let file = path.resolve(rootDir, decodeURIComponent(relPath))
  if (file !== rootDir && !file.startsWith(rootDir + path.sep)) throw httpError(403, 'Forbidden')
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!spaFallback) throw httpError(404, 'Not found')
    file = path.join(rootDir, 'index.html')
    if (!fs.existsSync(file)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('The editor is not built: run `npm run build`')
    }
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}
