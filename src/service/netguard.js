// Outbound fetch for the hosted service (remote attachments): public hosts only.
// The address check runs inside the socket `lookup`, so DNS rebinding cannot switch to a private IP
// after the check. Redirects are followed manually (each hop is checked again).
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'

const MAX_REDIRECTS = 3

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') ||
    v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff') || v6.startsWith('64:ff9b')
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }]
    const bad = list.find(a => isPrivateAddress(a.address))
    if (bad) return callback(Object.assign(new Error(`blocked private address ${bad.address}`), { code: 'EBLOCKED' }))
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

/** fetch-like: safeFetch(url, { signal, maxBytes }) → { ok, status, headers.get(), arrayBuffer() } */
export function safeFetch(url, { signal, maxBytes = 20 * 1024 * 1024 } = {}, hop = 0) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(new Error(`Invalid URL ${url}`)) }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error(`Protocol not allowed: ${u.protocol}`))
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ''))) {
      return reject(Object.assign(new Error(`blocked private address ${u.hostname}`), { code: 'EBLOCKED' }))
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(u, { lookup: guardedLookup, signal, headers: { 'User-Agent': 'templaitor' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        if (hop >= MAX_REDIRECTS) return reject(new Error('Too many redirects'))
        return resolve(safeFetch(new URL(res.headers.location, u).href, { signal, maxBytes }, hop + 1))
      }
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > maxBytes) { req.destroy(new Error('File too large')); return }
        chunks.push(c)
      })
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
        })
      })
      res.on('error', reject)
    })
    req.on('error', (err) => reject(Object.assign(err, { cause: { code: err.code } })))
  })
}
