// Template version system: named snapshots of a document (template, component or layout) that can be listed,
// read, compared and restored. The storage is pluggable (`project.versionStore`):
//   git (default) — local editor and hosted `fs` storage: a version is a commit of the document's files
//   db            — hosted `db` storage (src/service/versions.js): versions kept in the database
//
// A store implements: info() · list(doc, { limit }) · read(doc, rev) · save(doc, { message, author }) · init?()
import fs from 'node:fs'
import { documentFiles, gitVersionStore } from './history.js'
import { httpError } from './project.js'

export function versionStore(project) {
  project.versionStore ??= gitVersionStore(project)
  return project.versionStore
}

function docOf(project, id, kind) {
  if (!id) throw httpError(400, 'Missing id')
  const files = documentFiles(project, id, kind)
  if (!fs.existsSync(files.mjml)) throw httpError(404, `Not found: ${id}`)
  return {
    kind, id, files,
    /** Current contents on disk ({ mjml, yml, data }; null for a missing file) */
    current: () => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null])),
  }
}

/**
 * Versions of a document, newest first →
 *   { backend: 'git' | 'db' | null, available, canInit, branch?, reason?, dirty, versions: [{ id, short, number, message, author, date }] }
 * `dirty`: the saved files differ from the latest version.
 */
export async function listVersions(project, id, kind = 'template', { limit } = {}) {
  const store = versionStore(project)
  const info = await store.info()
  if (!info.available) return { ...info, dirty: false, versions: [] }
  const doc = docOf(project, id, kind)
  return { ...info, ...await store.list(doc, { limit }) }
}

/** A document at a version → { id, short, number?, message, author, date, kind, mjml, yml, data } */
export async function readVersion(project, id, kind = 'template', rev) {
  const store = versionStore(project)
  const files = documentFiles(project, id, kind)
  const v = await store.read({ kind, id, files }, String(rev || ''))
  return {
    ...v, files: undefined, kind, id,
    mjml: v.files.mjml,
    ...(kind === 'layout' ? {} : { yml: v.files.yml ?? null, data: v.files.data ?? null }),
  }
}

/** Saves the document as it is on disk as a new version → the new version */
export async function saveVersion(project, id, kind = 'template', { message, author } = {}) {
  const store = versionStore(project)
  const info = await store.info()
  if (!info.available) throw httpError(409, info.reason || 'Versions are not available for this project')
  const doc = docOf(project, id, kind)
  const text = String(message ?? '').replace(/\r/g, '').trim().slice(0, 500) || `Update ${id}`
  return store.save(doc, { message: text, author })
}

/** Turns on versions for a project that has none (git: `git init` + first commit) */
export async function initVersions(project, { author } = {}) {
  const store = versionStore(project)
  if (!store.init) throw httpError(400, 'Versions are always on with this storage')
  return store.init({ author })
}
