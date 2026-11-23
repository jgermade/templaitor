// Template version system: named snapshots of a document (template, component or layout) that can be listed,
// read, compared and restored. The storage is pluggable (`project.versionStore`):
//   git (default) — local editor and hosted `fs` storage: a version is a commit of the document's files
//   db            — hosted `db` storage (src/service/versions.js): versions kept in the database
//
// A store implements: info() · list(doc, { limit }) · read(doc, rev) · revOf(doc, number) · save(doc, { message, author }) · init?()
import fs from 'node:fs'
import { documentFiles, gitVersionStore } from './history.js'
import { snapshotFile, snapshotVersionStore } from './snapshot.js'
import { httpError } from './project.js'

export function versionStore(project) {
  project.versionStore ??= autoVersionStore(project)
  return project.versionStore
}

/**
 * git when the project is in a repository; otherwise the snapshot exported at build time
 * (`templaitor versions export` → .templaitor/versions.json), e.g. inside a Docker image without .git
 */
export function autoVersionStore(project, gitOptions = {}) {
  const git = gitVersionStore(project, gitOptions)
  const file = snapshotFile(project)
  // an installed package (…/node_modules/…) always uses its snapshot: the git repository around it, if any,
  // is the consumer's, not the one where its versions were made
  const installed = project.cwd.split(/[\\/]/).includes('node_modules')
  const pick = async () => (fs.existsSync(file) && (installed || !(await git.info()).available) ? snapshotVersionStore(project, file) : git)
  const call = (m) => async (...a) => { const s = await pick(); if (!s[m]) throw httpError(409, 'Versions are read-only here'); return s[m](...a) }
  return { backend: 'auto', info: call('info'), list: call('list'), read: call('read'), revOf: call('revOf'), save: call('save'), init: call('init') }
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
  return { ...info, ...await store.list(doc, { limit: Math.min(Number(limit) || 50, 200) }) }
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

/**
 * A version picked by the API (`/v1/send { version }`): `3` / `"v3"` (number), `"latest"` (newest version,
 * ignoring files saved after it) or a revision / version id → readVersion() result
 */
export async function resolveVersion(project, id, kind = 'template', spec) {
  const store = versionStore(project)
  const info = await store.info()
  if (!info.available) throw httpError(409, `Versions are not available for this project: ${info.reason || 'no version store'}`)
  const doc = docOf(project, id, kind)
  const s = String(spec ?? '').trim()
  if (!s || s.length > 64) throw httpError(400, `Invalid version: ${s.slice(0, 64)}`)
  let rev = s
  if (/^latest$/i.test(s)) {
    rev = (await store.list(doc, { limit: 1 })).versions[0]?.rev
    if (!rev) throw httpError(404, `${id} has no versions yet`)
  } else if (/^v?\d{1,9}$/i.test(s)) {
    const n = Number(s.replace(/^v/i, ''))
    rev = n > 0 ? await store.revOf(doc, n) : null
    if (!rev) throw httpError(404, `${id} has no version v${n}`)
  }
  return readVersion(project, id, kind, rev)
}
