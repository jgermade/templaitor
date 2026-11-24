// Version store of the in-browser demo: each version is a copy of the document's files, numbered per
// document (v1, v2…), kept in a JSON file of the virtual fs (so it persists in IndexedDB with the rest).
// Same interface as the git and database stores (src/engine/versions.js).
import fs from 'node:fs'
import path from 'node:path'

export function demoVersionStore(project) {
  const file = path.join(project.cwd, '.templaitor', 'demo-versions.json')
  const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {})
  const store = (all) => fs.writeFileSync(file, JSON.stringify(all))
  const key = (doc) => `${doc.kind}:${doc.id}`
  const hashOf = (f) => JSON.stringify([f.mjml ?? null, f.yml ?? null, f.data ?? null])
  const view = (v) => ({ id: v.id, rev: v.id, short: `v${v.number}`, number: v.number, message: v.message, author: v.author, email: v.email, date: v.date })
  const err = (status, message) => Object.assign(new Error(message), { status })

  return {
    backend: 'db',
    info: async () => ({ backend: 'db', available: true, canInit: false }),

    async list(doc, { limit = 50 } = {}) {
      const rows = (load()[key(doc)] || []).slice().reverse()
      return { versions: rows.slice(0, limit).map(view), dirty: !rows.length || hashOf(rows[0].files) !== hashOf(doc.current()) }
    },

    async read(doc, rev) {
      const v = (load()[key(doc)] || []).find(r => r.id === rev)
      if (!v) throw err(404, `Version not found: ${rev}`)
      return { ...view(v), files: v.files }
    },

    async revOf(doc, n) {
      return (load()[key(doc)] || []).find(r => r.number === Number(n))?.id ?? null
    },

    async save(doc, { message, author } = {}) {
      const all = load()
      const rows = all[key(doc)] ||= []
      const files = doc.current()
      if (rows.length && hashOf(rows.at(-1).files) === hashOf(files)) throw err(409, 'No changes since the last version')
      const v = {
        id: crypto.randomUUID(), number: (rows.at(-1)?.number || 0) + 1, message,
        author: author?.name || 'You', email: author?.email || 'demo@templaitor.local', date: new Date().toISOString(), files,
      }
      rows.push(v)
      store(all)
      return view(v)
    },
  }
}
