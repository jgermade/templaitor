// Small HTTP helpers for the hosted service (node:http, no framework).

export function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    maxAge != null ? `Max-Age=${Math.floor(maxAge / 1000)}` : '',
    httpOnly ? 'HttpOnly' : '',
    secure ? 'Secure' : '',
    `SameSite=${sameSite}`,
  ].filter(Boolean).join('; ')
}

export function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(httpError(413, 'Payload too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit)
  if (!buf.length) return {}
  try { return JSON.parse(buf.toString('utf8')) } catch { throw httpError(400, 'Invalid JSON') }
}

export function sendJson(res, data, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(data))
}

/** Simple in-memory fixed-window rate limiter: allow(key) → true while under `max` per `windowMs` */
export function rateLimiter({ max, windowMs }) {
  const hits = new Map()
  return {
    allow(key) {
      const t = Date.now()
      const h = hits.get(key)
      if (!h || t - h.start >= windowMs) { hits.set(key, { start: t, n: 1 }); return true }
      h.n++
      if (hits.size > 10000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k)
      return h.n <= max
    },
  }
}
