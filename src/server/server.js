// Servidor del editor: API JSON + ficheros estáticos del SPA (dist/editor)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import JSON5 from 'json5'
import {
  listTemplates, readTemplate, writeTemplate, createTemplate, deleteTemplate,
  listMjmlFiles, resolveAuxFile, httpError, listComponents, createComponent,
} from '../engine/project.js'
import { previewDraft, compileProject, compileSource, langsOf } from '../engine/pipeline.js'
import { readLinks } from '../engine/project.js'
import { renderJinja } from '../engine/render.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDITOR_DIST = path.resolve(__dirname, '../../dist/editor')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
}

export function createHandler(project) {
  const routes = {
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
      smtp: project.smtp ? { label: project.smtp.label || 'Enviar', web: project.smtp.web || null } : null,
      componentsDir: rel(project, project.componentsDir),
    }),

    'GET /api/templates': () => listTemplates(project),

    'GET /api/components': () => listComponents(project),

    // `kind`: 'template' (por defecto) | 'component'
    'GET /api/template': ({ query }) => readTemplate(project, query.get('id'), kindOf(query.get('kind'))),

    'PUT /api/template': ({ body }) => {
      validateDraft(body)
      return writeTemplate(project, body.id, body, kindOf(body.kind))
    },

    'POST /api/templates': ({ body }) => createTemplate(project, body.id, { layout: body.layout, langs: body.langs }),

    'POST /api/components': ({ body }) => {
      if (body.yml) validateDraft({ id: body.id, yml: body.yml })
      return createComponent(project, body.id, {
        mjml: body.mjml,
        messages: body.yml ? YAML.parse(body.yml)?.messages : undefined,
        data: body.data ? JSON5.parse(body.data) : undefined,
      })
    },

    'DELETE /api/template': ({ query }) => {
      deleteTemplate(project, query.get('id'), kindOf(query.get('kind')))
      return { ok: true }
    },

    'POST /api/preview': ({ body }) => previewDraft(project, {
      mjml: body.mjml, yml: body.yml, data: body.data, langKey: body.lang, mode: body.mode, kind: kindOf(body.kind),
    }),

    'POST /api/compile': async ({ body }) => {
      const r = await compileProject(project, { target: body?.id, log: null })
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
      if (!project.smtp) throw httpError(400, 'SMTP no configurado (añade `smtp` a templaitor.config.yml)')
      const { default: nodemailer } = await import('nodemailer')
      const i18n = YAML.parse(body.yml || '') || {}
      const data = JSON5.parse(body.data || '{}')
      const lang = body.lang || langsOf(project, i18n)[0]
      const r = await compileSource(project, { mjml: body.mjml, i18n, links: readLinks(project), langKey: lang, kind: kindOf(body.kind) })
      const transport = nodemailer.createTransport({
        host: project.smtp.host || 'localhost',
        port: Number(project.smtp.port || 1025),
        secure: !!project.smtp.secure,
        ...(project.smtp.user ? { auth: { user: project.smtp.user, pass: process.env[project.smtp.passEnv || 'SMTP_PASS'] } } : {}),
      })
      const info = await transport.sendMail({
        from: project.smtp.from || 'templaitor@localhost',
        to: body.to,
        subject: renderJinja(r.subject, data),
        html: renderJinja(r.html, data),
        text: renderJinja(r.text, data),
      }).catch((err) => {
        const where = `${project.smtp.host || 'localhost'}:${project.smtp.port || 1025}`
        throw httpError(502, /ECONNREFUSED/.test(`${err.code} ${err.message}`) ? `No hay servidor SMTP en ${where} (¿Mailpit arrancado? make up)` : err.message)
      })
      return { ok: true, messageId: info.messageId }
    },
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = routes[`${req.method} ${url.pathname}`]
        if (!route) throw httpError(404, 'Ruta no encontrada')
        const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : null
        return sendJson(res, await route({ query: url.searchParams, body }))
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
      if (!fs.existsSync(EDITOR_DIST)) console.log('  (aviso) dist/editor no existe: ejecuta `npm run build` o usa `npm run dev`)\n')
      if (open) import('node:child_process').then(({ exec }) => exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`))
      resolve(server)
    })
  })
}

// ── helpers ───────────────────────────────────────────────────

const kindOf = (k) => (k === 'component' ? 'component' : 'template')

function rel(project, file) {
  return path.relative(project.templatesDir, file).split(path.sep).join('/')
}

function validateDraft(body) {
  if (!body?.id) throw httpError(400, 'Falta id')
  if (body.yml) {
    try { YAML.parse(body.yml) } catch (e) { throw httpError(400, `YAML no válido: ${e.message.split('\n')[0]}`) }
  }
  if (body.data) {
    try { JSON5.parse(body.data) } catch (e) { throw httpError(400, `JSON5 no válido: ${e.message}`) }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c; if (data.length > 5e6) reject(httpError(413, 'Demasiado grande')) })
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch { reject(httpError(400, 'JSON no válido')) } })
    req.on('error', reject)
  })
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function serveFile(res, rootDir, relPath, spaFallback = false) {
  let file = path.resolve(rootDir, decodeURIComponent(relPath))
  if (file !== rootDir && !file.startsWith(rootDir + path.sep)) throw httpError(403, 'Prohibido')
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!spaFallback) throw httpError(404, 'No encontrado')
    file = path.join(rootDir, 'index.html')
    if (!fs.existsSync(file)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Editor no compilado: ejecuta `npm run build`')
    }
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}
