// Version store of the hosted service with `db` storage (no git there): each version is a row with the
// document's files, numbered per document (v1, v2…). Same interface as the git store (src/engine/history.js).
import { sha256 } from './crypto.js'
import { httpError } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hashOf = (files) => sha256(JSON.stringify([files.mjml ?? null, files.yml ?? null, files.data ?? null]))

export function dbVersionStore({ repo, orgId }) {
  const view = (v) => ({
    id: v.id, rev: v.id, short: `v${v.number}`, number: v.number, message: v.message,
    author: v.author_name || v.author_email, email: v.author_email, date: new Date(v.created_at).toISOString(),
  })

  const store = {
    backend: 'db',
    info: async () => ({ backend: 'db', available: true, canInit: false }),

    async list(doc, { limit = 50 } = {}) {
      const rows = await repo.versions(orgId, doc.kind, doc.id, limit)
      return { versions: rows.map(view), dirty: !rows.length || rows[0].hash !== hashOf(doc.current()) }
    },

    async read(doc, rev) {
      if (!UUID.test(rev)) throw httpError(400, `Invalid version: ${rev}`)
      const v = await repo.version(orgId, doc.kind, doc.id, rev)
      if (!v) throw httpError(404, `Version not found: ${rev}`)
      return { ...view(v), files: v.files }
    },

    async save(doc, { message, author } = {}) {
      const files = doc.current()
      const hash = hashOf(files)
      const [last] = await repo.versions(orgId, doc.kind, doc.id, 1)
      if (last?.hash === hash) throw httpError(409, 'No changes since the last version')
      const save = () => repo.createVersion({
        orgId, kind: doc.kind, docId: doc.id, message, authorName: author?.name, authorEmail: author?.email, files, hash,
      })
      // two saves at the same time may pick the same number: the UNIQUE constraint rejects one, retry it
      const v = await save().catch(() => save())
      return view(v)
    },
  }
  return store
}
