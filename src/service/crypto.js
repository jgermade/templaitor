// Tokens, hashes and secret encryption for the hosted service.
import crypto from 'node:crypto'

export const randomId = () => crypto.randomUUID()

/** URL-safe random token */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

/** Keyed hash (HMAC-SHA256) for tokens, codes and API keys stored in the database */
export function hashToken(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex')
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** 6-digit one-time code */
export const otpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

/** AES-256-GCM with a key derived from the service secret → "v1:<iv>:<tag>:<data>" (base64url) */
export function encrypt(secret, plain) {
  if (plain == null || plain === '') return ''
  const key = crypto.createHash('sha256').update(`templaitor:enc:${secret}`).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':')
}

export function decrypt(secret, value) {
  if (!value) return ''
  const [v, iv, tag, data] = String(value).split(':')
  if (v !== 'v1') throw new Error('Unknown encryption format')
  const key = crypto.createHash('sha256').update(`templaitor:enc:${secret}`).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
