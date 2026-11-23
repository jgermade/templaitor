// Git backend of the template version system: a version of a document (template, component or layout) is a
// commit that touched its files (`.mjml`, `.yml`, `.json5`). Used by the local editor and by the hosted
// service with `fs` storage. Saving a version commits only the document's own files.
//
// git always runs with `execFile` (no shell) from the project directory; paths are given relative to it
// (`rev:./path`), so symlinked project folders work too.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { templatePaths, httpError } from './project.js'

const REV = /^[0-9a-f]{7,40}$/i
const SEP = '\x1f'
const FORMAT = `--format=%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%aI${SEP}%s`
const FALLBACK_IDENTITY = { name: 'templaitor', email: 'templaitor@localhost' }

export function git(cwd, args, { timeout = 15000, env } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], {
      cwd, timeout, maxBuffer: 20 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined,
    }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, missing: err?.code === 'ENOENT', stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** Files of a document: { mjml, yml, data } (absolute paths; a layout only has mjml) */
export function documentFiles(project, id, kind = 'template') {
  if (kind === 'layout') {
    if (!/^[\w.-]+\.mjml$/.test(String(id || ''))) throw httpError(400, `Invalid layout: ${id}`)
    return { mjml: path.join(project.layoutsDir, id) }
  }
  const p = templatePaths(project, id, kind)
  return { mjml: p.mjml, yml: p.yml, data: p.data }
}

const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).pop() || 'git failed'
const clean = (s, max) => String(s ?? '').replace(/[<>\r\n\0]/g, ' ').trim().slice(0, max)

/**
 * Version store backed by git.
 *   rootMustBe: only use a repository whose top level is exactly this folder (hosted service: an org's
 *               folder must not fall back to a repository that happens to contain the data directory)
 *   committer:  identity used when git has none configured (default "templaitor <templaitor@localhost>")
 */
export function gitVersionStore(project, { rootMustBe = null, committer = null } = {}) {
  const cwd = () => project.cwd
  const rel = (file) => `./${path.relative(project.cwd, file).split(path.sep).join('/')}`

  async function repoRoot() {
    if (!fs.existsSync(project.cwd)) return { root: null }
    const r = await git(project.cwd, ['rev-parse', '--show-toplevel'])
    if (r.missing) return { root: null, noGit: true }
    if (!r.ok) return { root: null }
    const root = r.stdout.trim()
    if (rootMustBe && realpath(root) !== realpath(rootMustBe)) return { root: null }
    return { root }
  }

  async function requireRoot() {
    const { root, noGit } = await repoRoot()
    if (noGit) throw httpError(501, 'git is not installed')
    if (!root) throw httpError(409, 'The project is not in a git repository')
    return root
  }

  /** `-c user.name/-c user.email` when the repository has no identity configured */
  async function identityArgs() {
    const [n, e] = await Promise.all([git(cwd(), ['config', 'user.name']), git(cwd(), ['config', 'user.email'])])
    const id = committer || FALLBACK_IDENTITY
    return [
      ...(n.stdout.trim() ? [] : ['-c', `user.name=${clean(id.name, 100) || FALLBACK_IDENTITY.name}`]),
      ...(e.stdout.trim() ? [] : ['-c', `user.email=${clean(id.email, 200) || FALLBACK_IDENTITY.email}`]),
    ]
  }

  const parse = (line) => {
    const [rev, short, author, email, date, message] = line.split(SEP)
    return { id: rev, rev, short, author, email, date, message }
  }

  const store = {
    backend: 'git',

    async info() {
      const { root, noGit } = await repoRoot()
      if (!root) return { backend: null, available: false, canInit: !noGit, reason: noGit ? 'git is not installed' : 'The project is not in a git repository' }
      const b = await git(cwd(), ['rev-parse', '--abbrev-ref', 'HEAD'])
      return { backend: 'git', available: true, canInit: false, branch: b.ok ? b.stdout.trim() : null }
    },

    async list(doc, { limit = 50 } = {}) {
      await requireRoot()
      const files = Object.values(doc.files).map(rel)
      const n = Math.min(Number(limit) || 50, 200)
      const [log, count, status] = await Promise.all([
        git(cwd(), ['log', `-n${n}`, FORMAT, '--', ...files]),
        git(cwd(), ['rev-list', '--count', 'HEAD', '--', ...files]),
        git(cwd(), ['status', '--porcelain', '--', ...files]),
      ])
      // an empty repository (no commits yet) has no HEAD: no versions
      const lines = log.ok ? log.stdout.split('\n').filter(Boolean) : []
      const total = count.ok ? Number(count.stdout.trim()) || lines.length : lines.length
      const versions = lines.map((line, i) => ({ ...parse(line), number: total - i }))
      return { versions, dirty: status.ok && status.stdout.trim().length > 0 }
    },

    async read(doc, rev) {
      if (!REV.test(String(rev || ''))) throw httpError(400, `Invalid revision: ${rev}`)
      await requireRoot()
      const out = {}
      for (const [key, file] of Object.entries(doc.files)) {
        const r = await git(cwd(), ['show', `${rev}:${rel(file)}`])
        out[key] = r.ok ? r.stdout : null
      }
      if (out.mjml == null) throw httpError(404, `${doc.id} did not exist at ${String(rev).slice(0, 7)}`)
      const files = Object.values(doc.files).map(rel)
      const [meta, count] = await Promise.all([
        git(cwd(), ['log', '-n1', FORMAT, rev]),
        // number of the version in effect at that commit (commits that touched the document up to it)
        git(cwd(), ['rev-list', '--count', rev, '--', ...files]),
      ])
      const number = count.ok ? Number(count.stdout.trim()) || null : null
      return { ...(meta.ok && meta.stdout.trim() ? parse(meta.stdout.trim()) : { id: rev, rev, short: rev.slice(0, 7) }), number, files: out }
    },

    /** Revision of version number `n` (1 = oldest) or null */
    async revOf(doc, n) {
      await requireRoot()
      const r = await git(cwd(), ['rev-list', '--reverse', 'HEAD', '--', ...Object.values(doc.files).map(rel)])
      return r.ok ? r.stdout.split('\n').filter(Boolean)[n - 1] ?? null : null
    },

    async save(doc, { message, author } = {}) {
      await requireRoot()
      const files = Object.values(doc.files).filter(f => fs.existsSync(f)).map(rel)
      if (!files.length) throw httpError(404, `${doc.id} has no files`)
      const add = await git(cwd(), ['add', '-A', '--', ...files])
      if (!add.ok) throw httpError(500, `git add: ${lastLine(add.stderr)}`)
      // nothing staged for these files → nothing new to version
      const diff = await git(cwd(), ['diff', '--cached', '--quiet', '--', ...files])
      if (diff.ok) throw httpError(409, 'No changes since the last version')
      const authorArgs = author?.email ? [`--author=${clean(author.name, 100) || clean(author.email, 200)} <${clean(author.email, 200)}>`] : []
      // `-- files` commits only this document, never other changes the user has staged
      const c = await git(cwd(), [...await identityArgs(), 'commit', '-q', '-m', message, ...authorArgs, '--', ...files], { timeout: 60000 })
      if (!c.ok) throw httpError(500, `git commit: ${lastLine(c.stderr || c.stdout)}`)
      const { versions } = await store.list(doc, { limit: 1 })
      return versions[0]
    },

    /** `git init` + .gitignore (compiled output) + a first commit with every file of the project */
    async init({ author } = {}) {
      const { root, noGit } = await repoRoot()
      if (noGit) throw httpError(501, 'git is not installed')
      if (root) throw httpError(409, 'The project is already in a git repository')
      fs.mkdirSync(project.cwd, { recursive: true })
      const r = await git(project.cwd, ['init', '-q'])
      if (!r.ok) throw httpError(500, `git init: ${lastLine(r.stderr)}`)
      const ignore = path.join(project.cwd, '.gitignore')
      if (!fs.existsSync(ignore)) {
        const out = path.relative(project.cwd, project.outDir).split(path.sep).join('/')
        fs.writeFileSync(ignore, `${out && !out.startsWith('..') ? `/${out}/\n` : ''}node_modules/\n`)
      }
      await git(project.cwd, ['add', '-A'])
      const authorArgs = author?.email ? [`--author=${clean(author.name, 100) || clean(author.email, 200)} <${clean(author.email, 200)}>`] : []
      const c = await git(project.cwd, [...await identityArgs(), 'commit', '-q', '-m', 'Initial version', ...authorArgs], { timeout: 60000 })
      if (!c.ok && !/nothing to commit/.test(c.stdout + c.stderr)) throw httpError(500, `git commit: ${lastLine(c.stderr || c.stdout)}`)
      return store.info()
    },
  }
  return store
}

function realpath(p) {
  try { return fs.realpathSync(p) } catch { return path.resolve(p) }
}
