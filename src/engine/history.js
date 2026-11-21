// Version history of a template (or component / layout) from git, when the project lives in a repository.
// Used by the editor's compare mode: list the commits that touched the document and read it at a commit.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { templatePaths, httpError } from './project.js'

const REV = /^[0-9a-f]{7,40}$/i
const SEP = '\x1f'

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeout: 15000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) })
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

async function repoRoot(project) {
  if (!fs.existsSync(project.templatesDir)) return null
  const r = await git(project.templatesDir, ['rev-parse', '--show-toplevel'])
  return r.ok ? r.stdout.trim() : null
}

/** Commits that changed the document (newest first) → { git: bool, commits: [{ rev, short, author, date, subject }] } */
export async function documentHistory(project, id, kind = 'template', { limit = 50 } = {}) {
  const root = await repoRoot(project)
  if (!root) return { git: false, commits: [] }
  const files = Object.values(documentFiles(project, id, kind)).map(f => path.relative(root, f))
  const r = await git(root, ['log', `-n${Math.min(Number(limit) || 50, 200)}`, `--format=%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s`, '--', ...files])
  if (!r.ok) return { git: true, commits: [], error: r.stderr.trim().split('\n').pop() }
  const commits = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [rev, short, author, date, subject] = line.split(SEP)
    return { rev, short, author, date, subject }
  })
  // uncommitted changes on disk (saved but not committed)
  const status = await git(root, ['status', '--porcelain', '--', ...files])
  return { git: true, commits, dirty: status.ok && status.stdout.trim().length > 0 }
}

/** The document at a commit → { rev, mjml, yml, data } ('' for files that did not exist then) */
export async function documentAt(project, id, kind = 'template', rev) {
  if (!REV.test(String(rev || ''))) throw httpError(400, `Invalid revision: ${rev}`)
  const root = await repoRoot(project)
  if (!root) throw httpError(404, 'The project is not in a git repository')
  const out = { rev, kind, id }
  for (const [key, file] of Object.entries(documentFiles(project, id, kind))) {
    const rel = path.relative(root, file).split(path.sep).join('/')
    const r = await git(root, ['show', `${rev}:${rel}`])
    out[key] = r.ok ? r.stdout : ''
  }
  if (!out.mjml) throw httpError(404, `${id} did not exist at ${rev.slice(0, 7)}`)
  out.yml ??= ''
  out.data ??= '{}\n'
  return out
}
