// Postgres adapter (node-postgres). Same async interface as the SQLite adapter; SQL is written with `?`
// placeholders and converted to `$n`. Transactions run on a dedicated client, found through
// AsyncLocalStorage, so repository code does not change. Several instances can share the database:
// migrations take an advisory lock and the send queue is claimed with FOR UPDATE SKIP LOCKED.
import { AsyncLocalStorage } from 'node:async_hooks'
import { migrate } from './migrations.js'

const MIGRATION_LOCK = 727274 // arbitrary advisory-lock key for templaitor migrations

export async function openPostgres(url) {
  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    throw new Error('Postgres needs the `pg` package: npm install pg')
  }
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.TEMPLAITOR_DATABASE_POOL || 10) })
  pool.on('error', (err) => console.error(`postgres: ${err.message}`))
  const tx = new AsyncLocalStorage()

  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`) }
  const norm = (params) => params.map(p => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p instanceof Uint8Array && !Buffer.isBuffer(p) ? Buffer.from(p) : p))
  const query = (sql, params = []) => (tx.getStore() ?? pool).query(toPg(sql), norm(params))
  // BIGINT (timestamps, COUNT) as JavaScript numbers instead of strings
  const parse = (rows, fields) => {
    const int8 = fields.filter(f => f.dataTypeID === 20).map(f => f.name)
    if (int8.length) for (const r of rows) for (const k of int8) if (r[k] != null) r[k] = Number(r[k])
    return rows
  }

  const db = {
    driver: 'postgres',
    async get(sql, ...params) { const r = await query(sql, params); return parse(r.rows, r.fields)[0] ?? null },
    async all(sql, ...params) { const r = await query(sql, params); return parse(r.rows, r.fields) },
    async run(sql, ...params) { const r = await query(sql, params); return { changes: r.rowCount ?? 0 } },
    async exec(sql) { await (tx.getStore() ?? pool).query(sql) },
    /** Runs `fn` in a transaction (nested calls join the outer one) */
    async tx(fn) {
      if (tx.getStore()) return fn()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await tx.run(client, fn)
        await client.query('COMMIT')
        return out
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }

  try {
    await db.tx(async () => {
      await db.run('SELECT pg_advisory_xact_lock(?)', MIGRATION_LOCK)
      await migrate(db, { bigint: 'BIGINT', blob: 'BYTEA' })
    })
  } catch (err) {
    await pool.end().catch(() => {})
    throw new Error(`Postgres: ${err.message}`)
  }
  return db
}
