// Versions exported from git into a JSON file (`templaitor versions export` → .templaitor/versions.json), so a
// deployment without the repository (Docker image, npm package) keeps the version history: listing, reading,
// comparing and `/v1/send { version }` work; saving versions does not (read-only).
import fs from 'node:fs'
import path from 'node:path'
import { gitVersionStore, documentFiles } from './history.js'
import { listTemplates, listComponents, listMjmlFiles, httpError } from './project.js'

export const snapshotFile = (project) => path.join(project.cwd, '.templaitor', 'versions.json')
const keyOf = (kind, id) => `${kind}:${id}`

/** Every version of every document of a git project → snapshot object (also written to `file`) */
export async function exportVersions(project, { file = snapshotFile(project), log = null } = {}) {
  const git = gitVersionStore(project)
  const info = await git.info()
  if (!info.available) throw new Error(`Cannot export versions: ${info.reason}`)
  const docs = [
    ...listTemplates(project).map(t => ['template', t.id]),
    ...listComponents(project).map(c => ['component', c.id]),
    ...listMjmlFiles(project.layoutsDir).map(f => ['layout', f]),
  ]
  const documents = {}
  let count = 0
  for (const [kind, id] of docs) {
    const doc = { kind, id, files: documentFiles(project, id, kind) }
    const { versions } = await git.list(doc, { limit: 100000 })
    documents[keyOf(kind, id)] = []
    for (const v of versions) {
      const { files } = await git.read(doc, v.rev)
      documents[keyOf(kind, id)].push({ ...v, id: v.rev, files })
      count++
    }
    log?.(`  ${kind} ${id}: ${versions.length} version(s)`)
  }
  const snapshot = { format: 1, generatedAt: new Date().toISOString(), branch: info.branch ?? null, documents }
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(snapshot)}\n`)
  }
  return { file, documents: docs.length, versions: count, snapshot }
}

export function snapshotVersionStore(project, file = snapshotFile(project)) {
  let cache = null
  const load = () => {
    const stat = fs.statSync(file)
    if (!cache || cache.mtime !== stat.mtimeMs) cache = { mtime: stat.mtimeMs, data: JSON.parse(fs.readFileSync(file, 'utf8')) }
    return cache.data
  }
  const versionsOf = (doc) => load().documents?.[keyOf(doc.kind, doc.id)] ?? []
  const view = ({ files, ...v }) => v
  const same = (a, b) => Object.keys(b).every(k => (a[k] ?? null) === (b[k] ?? null))

  return {
    backend: 'snapshot',
    info: async () => ({ backend: 'snapshot', available: true, canInit: false, branch: load().branch ?? null, readOnly: true }),
    async list(doc, { limit = 50 } = {}) {
      const all = versionsOf(doc)
      const current = Object.fromEntries(Object.entries(doc.files).map(([k, f]) => [k, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]))
      return { versions: all.slice(0, Number(limit) || 50).map(view), dirty: !all.length || !same(current, all[0].files) }
    },
    async read(doc, rev) {
      const r = String(rev || '')
      if (!/^[0-9a-f]{4,40}$/i.test(r)) throw httpError(400, `Invalid revision: ${r}`)
      const v = versionsOf(doc).find(x => x.rev === r || x.rev.startsWith(r) || x.short === r)
      if (!v) throw httpError(404, `${doc.id} has no version ${r.slice(0, 12)}`)
      return { ...view(v), files: v.files }
    },
    async revOf(doc, n) {
      return versionsOf(doc).find(v => v.number === n)?.rev ?? null
    },
    async save() {
      throw httpError(409, 'Versions are read-only in this deployment (exported from git when it was built)')
    },
  }
}
