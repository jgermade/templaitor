// SQLite adapter (built-in node:sqlite). Same async interface as the Postgres adapter:
//   get(sql, ...params) → row | null · all → rows · run → { changes } · exec(sql) · tx(async fn) · close()
// SQL uses `?` placeholders. node:sqlite is synchronous and has one connection, so a transaction holds a
// lock: queries from other requests wait until it commits (queries inside it run directly).
import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { migrate } from './migrations.js'

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
  const inTx = new AsyncLocalStorage()
  let lock = Promise.resolve()
  // outside a transaction, wait for the one in progress (if any)
  const ready = () => (inTx.getStore() ? null : lock)

  const db = {
    driver: 'sqlite',
    async get(sql, ...params) { await ready(); return prep(sql).get(...norm(params)) ?? null },
    async all(sql, ...params) { await ready(); return prep(sql).all(...norm(params)) },
    async run(sql, ...params) { await ready(); const r = prep(sql).run(...norm(params)); return { changes: Number(r.changes) } },
    async exec(sql) { await ready(); raw.exec(sql) },
    /** Runs `fn` in a transaction (nested calls join the outer one) */
    async tx(fn) {
      if (inTx.getStore()) return fn()
      const prev = lock
      let release
      lock = new Promise(r => { release = r })
      await prev
      try {
        return await inTx.run(true, async () => {
          raw.exec('BEGIN IMMEDIATE')
          try {
            const out = await fn()
            raw.exec('COMMIT')
            return out
          } catch (err) {
            raw.exec('ROLLBACK')
            throw err
          }
        })
      } finally {
        release()
      }
    },
    async close() { await lock; raw.close() },
  }
  await migrate(db, { bigint: 'INTEGER', blob: 'BLOB' })
  return db
}
