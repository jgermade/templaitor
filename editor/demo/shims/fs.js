// In-memory `node:fs` for the in-browser demo: the synchronous subset the engine uses, over a Map of
// files. Every change is persisted to IndexedDB in the background (see ../vfs.js).
import path from 'path-browserify'
import { Buffer } from 'buffer'

const files = new Map() // absolute path → string | Uint8Array
const dirs = new Set(['/'])
let onChange = () => {}

const norm = (p) => path.resolve('/', String(p instanceof URL ? p.pathname : p))
const enoent = (op, p) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT', path: p })
const addParents = (p) => { for (let d = path.dirname(p); !dirs.has(d); d = path.dirname(d)) { dirs.add(d); onChange(d, 'dir') } }

export function existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p) }

export function readFileSync(p, opts) {
  p = norm(p)
  if (!files.has(p)) throw enoent('open', p)
  const enc = typeof opts === 'string' ? opts : opts?.encoding
  const v = files.get(p)
  if (enc) return typeof v === 'string' ? v : new TextDecoder().decode(v)
  return Buffer.from(typeof v === 'string' ? new TextEncoder().encode(v) : v)
}

export function writeFileSync(p, data) {
  p = norm(p)
  addParents(p)
  files.set(p, typeof data === 'string' ? data : new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data))
  onChange(p, 'file')
}

export function mkdirSync(p) {
  p = norm(p)
  if (dirs.has(p)) return
  addParents(p)
  dirs.add(p)
  onChange(p, 'dir')
}

const children = (p) => {
  const prefix = p === '/' ? '/' : `${p}/`
  const out = new Map()
  for (const [set, dir] of [[files, false], [dirs, true]]) {
    for (const k of set.keys ? set.keys() : set) {
      if (k === p || !k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      if (!rest.includes('/')) out.set(rest, dir)
    }
  }
  return out
}

export function readdirSync(p, opts) {
  p = norm(p)
  if (!dirs.has(p)) throw enoent('scandir', p)
  const list = [...children(p)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (opts?.withFileTypes) return list.map(([name, dir]) => ({ name, isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false }))
  return list.map(([name]) => name)
}

export function statSync(p, opts) {
  p = norm(p)
  const dir = dirs.has(p)
  if (!dir && !files.has(p)) {
    if (opts?.throwIfNoEntry === false) return undefined
    throw enoent('stat', p)
  }
  const v = files.get(p)
  const size = dir ? 0 : typeof v === 'string' ? new TextEncoder().encode(v).length : v.length
  return { isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false, size, mtimeMs: 0, mtime: new Date(0) }
}

export function rmSync(p, opts = {}) {
  p = norm(p)
  if (files.delete(p)) return onChange(p, 'delete')
  if (!dirs.has(p)) { if (opts.force) return; throw enoent('rm', p) }
  const prefix = `${p}/`
  if (!opts.recursive && [...files.keys(), ...dirs].some(k => k.startsWith(prefix))) throw Object.assign(new Error(`ENOTEMPTY: ${p}`), { code: 'ENOTEMPTY' })
  for (const k of [...files.keys()]) if (k.startsWith(prefix)) { files.delete(k); onChange(k, 'delete') }
  for (const k of [...dirs]) if (k.startsWith(prefix)) { dirs.delete(k); onChange(k, 'delete') }
  dirs.delete(p)
  onChange(p, 'delete')
}

export const rmdirSync = (p, opts) => rmSync(p, opts)
export const unlinkSync = (p) => { p = norm(p); if (!files.delete(p)) throw enoent('unlink', p); onChange(p, 'delete') }
export const realpathSync = (p) => norm(p)
realpathSync.native = realpathSync
export const chmodSync = () => {}
export const copyFileSync = (a, b) => writeFileSync(b, files.get(norm(a)) ?? (() => { throw enoent('copyfile', a) })())
export function renameSync(a, b) {
  a = norm(a); b = norm(b)
  if (files.has(a)) { writeFileSync(b, files.get(a)); files.delete(a); onChange(a, 'delete'); return }
  if (!dirs.has(a)) throw enoent('rename', a)
  for (const k of [...files.keys()]) if (k.startsWith(`${a}/`)) { writeFileSync(b + k.slice(a.length), files.get(k)); files.delete(k); onChange(k, 'delete') }
  mkdirSync(b)
  rmSync(a, { recursive: true, force: true })
}
let tmp = 0
export const mkdtempSync = (prefix) => { const p = `${norm(prefix)}${++tmp}`; mkdirSync(p); return p }
export const createReadStream = () => { throw new Error('Streams are not available in the browser demo') }

export const promises = {
  readFile: async (...a) => readFileSync(...a),
  writeFile: async (...a) => writeFileSync(...a),
  mkdir: async (...a) => mkdirSync(...a),
  rm: async (...a) => rmSync(...a),
  stat: async (...a) => statSync(...a),
  readdir: async (...a) => readdirSync(...a),
}

/** Internal API of the virtual file system (persistence and seeding) */
export const vfs = {
  files, dirs,
  get onChange() { return onChange },
  set onChange(fn) { onChange = fn },
  clear() { files.clear(); dirs.clear(); dirs.add('/') },
}

export default {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, rmdirSync, unlinkSync,
  realpathSync, chmodSync, copyFileSync, renameSync, mkdtempSync, createReadStream, promises,
}
