// SQLite adapter (built-in node:sqlite). The service only uses this small interface, so a Postgres
// adapter can implement the same methods (`?` placeholders → `$n`).
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATIONS } from './migrations.js'

export async function openSqlite(file) {
  // node:sqlite prints an ExperimentalWarning on load: silence only that one
  const emit = process.emitWarning
  process.emitWarning = (w, ...rest) => (String(w?.message ?? w).includes('SQLite') ? undefined : emit.call(process, w, ...rest))
  let DatabaseSync
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    throw new Error('The hosted service needs Node.js ≥ 22.13 (node:sqlite)')
  } finally {
    process.emitWarning = emit
  }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const stmts = new Map()
  const prep = (sql) => {
    let s = stmts.get(sql)
    if (!s) { s = raw.prepare(sql); stmts.set(sql, s) }
    return s
  }
  const norm = (params) => params.map(p => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p))
  let depth = 0

  const db = {
    driver: 'sqlite',
    get: (sql, ...params) => prep(sql).get(...norm(params)) ?? null,
    all: (sql, ...params) => prep(sql).all(...norm(params)),
    run: (sql, ...params) => { const r = prep(sql).run(...norm(params)); return { changes: Number(r.changes) } },
    exec: (sql) => raw.exec(sql),
    /** Runs fn in a transaction (nested calls join the outer one) */
    tx(fn) {
      if (depth) return fn()
      depth++
      raw.exec('BEGIN IMMEDIATE')
      try {
        const out = fn()
        raw.exec('COMMIT')
        return out
      } catch (err) {
        raw.exec('ROLLBACK')
        throw err
      } finally {
        depth--
      }
    },
    close: () => raw.close(),
  }
  migrate(db)
  return db
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const done = new Set(db.all('SELECT version FROM schema_migrations').map(r => r.version))
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1
    if (done.has(version)) return
    db.tx(() => {
      db.exec(sql)
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, Date.now())
    })
  })
}
