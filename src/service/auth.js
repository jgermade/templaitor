// Authentication: email one-time codes, passkeys (WebAuthn) and cookie sessions.
import { hashToken, randomToken, otpCode, safeEqual } from './crypto.js'
import { httpError, parseCookies, serializeCookie, rateLimiter } from './http.js'
import { normEmail } from './repo.js'

export const SESSION_COOKIE = 'tpl_session'
const CHALLENGE_COOKIE = 'tpl_challenge'
const SESSION_TTL = 30 * 24 * 3600e3
const OTP_TTL = 10 * 60e3
const OTP_MAX_ATTEMPTS = 5
const OTP_MAX_PER_15_MIN = 5
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createAuth({ config, repo, mailer }) {
  const ipLimiter = rateLimiter({ max: 30, windowMs: 15 * 60e3 })
  let webauthn = null
  const loadWebauthn = async () => (webauthn ??= await import('@simplewebauthn/server'))
  const cookieOpts = { secure: config.secure }

  /** Session of a request (cookie) → { session, user } or null */
  async function sessionOf(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (!token) return null
    const session = await repo.sessionByTokenHash(hashToken(config.secret, token))
    if (!session) return null
    const user = await repo.userById(session.user_id)
    if (!user) return null
    // sliding expiration (at most once an hour)
    if (Date.now() - session.last_seen_at > 3600e3) await repo.touchSession(session.id, SESSION_TTL)
    return { session, user }
  }

  async function startSession(req, res, user) {
    const token = randomToken()
    const orgs = await repo.orgsOfUser(user.id)
    await repo.createSession({ tokenHash: hashToken(config.secret, token), userId: user.id, ttlMs: SESSION_TTL, userAgent: req.headers['user-agent'], activeOrgId: orgs[0]?.id ?? null })
    await repo.touchLogin(user.id)
    appendCookie(res, serializeCookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL }))
  }

  /** Users allowed to sign in: existing users, invited emails, or anyone when signup is open */
  async function canSignIn(email) {
    return config.signup === 'open' || !!(await repo.userByEmail(email)) || (await repo.pendingInvitationsFor(email)).length > 0
  }

  async function userFor(email) {
    let user = await repo.userByEmail(email)
    if (!user) user = await repo.createUser(email, email.split('@')[0])
    await repo.acceptInvitations(user)
    return user
  }

  return {
    sessionOf,

    async requestCode(req, { email }) {
      email = normEmail(email)
      if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address')
      if (!ipLimiter.allow(`otp:${clientIp(req)}`)) throw httpError(429, 'Too many attempts; try again later')
      if (await repo.countOtpsSince(email, Date.now() - 15 * 60e3) >= OTP_MAX_PER_15_MIN) throw httpError(429, 'Too many codes requested; wait a few minutes')
      // same answer whether the email can sign in or not (no account enumeration)
      if (!(await canSignIn(email))) return { ok: true }
      const code = otpCode()
      await repo.createOtp({ email, codeHash: hashToken(config.secret, `otp:${email}:${code}`), ttlMs: OTP_TTL })
      await mailer.sendCode(email, code)
      return { ok: true }
    },

    async verifyCode(req, res, { email, code }) {
      email = normEmail(email)
      if (!ipLimiter.allow(`verify:${clientIp(req)}`)) throw httpError(429, 'Too many attempts; try again later')
      const otp = await repo.activeOtp(email)
      if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw httpError(400, 'The code has expired; request a new one')
      await repo.otpAttempt(otp.id)
      if (!safeEqual(otp.code_hash, hashToken(config.secret, `otp:${email}:${String(code || '').trim()}`))) {
        throw httpError(400, otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'Wrong code; request a new one' : 'Wrong code')
      }
      await repo.useOtp(otp.id)
      if (!(await canSignIn(email))) throw httpError(403, 'This email is not invited')
      const user = await userFor(email)
      await startSession(req, res, user)
      return { ok: true }
    },

    async logout(req, res) {
      const s = await sessionOf(req)
      if (s) await repo.deleteSession(s.session.id)
      appendCookie(res, serializeCookie(SESSION_COOKIE, '', { ...cookieOpts, maxAge: 0 }))
      return { ok: true }
    },

    // ── Passkeys ──
    async passkeyRegisterOptions(user) {
      const { generateRegistrationOptions } = await loadWebauthn()
      const options = await generateRegistrationOptions({
        rpName: config.appName,
        rpID: config.rpId,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        userDisplayName: user.name || user.email,
        attestationType: 'none',
        excludeCredentials: (await repo.passkeysOf(user.id)).map(p => ({ id: p.credential_id, transports: p.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      })
      const challengeId = await repo.createChallenge({ challenge: options.challenge, userId: user.id, kind: 'register' })
      return { options, challengeId }
    },

    async passkeyRegisterVerify(user, { challengeId, response, name }) {
      const { verifyRegistrationResponse } = await loadWebauthn()
      const ch = await repo.takeChallenge(challengeId, 'register')
      if (!ch || ch.user_id !== user.id) throw httpError(400, 'The passkey request expired; try again')
      let v
      try {
        v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: config.baseUrl, expectedRPID: config.rpId })
      } catch (e) {
        throw httpError(400, `Passkey not valid: ${e.message}`)
      }
      if (!v.verified) throw httpError(400, 'Passkey not verified')
      const c = v.registrationInfo.credential
      await repo.addPasskey({
        userId: user.id,
        credentialId: c.id,
        publicKey: Buffer.from(c.publicKey).toString('base64url'),
        counter: c.counter,
        transports: c.transports || response.response?.transports || [],
        name: String(name || '').slice(0, 60) || 'Passkey',
      })
      return { ok: true }
    },

    async passkeyLoginOptions(req, res) {
      if (!ipLimiter.allow(`pk:${clientIp(req)}`)) throw httpError(429, 'Too many attempts; try again later')
      const { generateAuthenticationOptions } = await loadWebauthn()
      // discoverable credentials: the browser offers the passkeys it has for this site
      const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'preferred' })
      const id = await repo.createChallenge({ challenge: options.challenge, kind: 'login' })
      appendCookie(res, serializeCookie(CHALLENGE_COOKIE, id, { ...cookieOpts, maxAge: 5 * 60e3 }))
      return { options }
    },

    async passkeyLoginVerify(req, res, { response }) {
      const { verifyAuthenticationResponse } = await loadWebauthn()
      const ch = await repo.takeChallenge(parseCookies(req.headers.cookie)[CHALLENGE_COOKIE], 'login')
      appendCookie(res, serializeCookie(CHALLENGE_COOKIE, '', { ...cookieOpts, maxAge: 0 }))
      if (!ch) throw httpError(400, 'The passkey request expired; try again')
      const pk = await repo.passkeyByCredentialId(response?.id)
      if (!pk) throw httpError(400, 'Unknown passkey (it may have been removed)')
      let v
      try {
        v = await verifyAuthenticationResponse({
          response,
          expectedChallenge: ch.challenge,
          expectedOrigin: config.baseUrl,
          expectedRPID: config.rpId,
          credential: { id: pk.credential_id, publicKey: Buffer.from(pk.public_key, 'base64url'), counter: pk.counter, transports: pk.transports },
        })
      } catch (e) {
        throw httpError(400, `Passkey not valid: ${e.message}`)
      }
      if (!v.verified) throw httpError(400, 'Passkey not verified')
      await repo.usePasskey(pk.id, v.authenticationInfo.newCounter)
      const user = await repo.userById(pk.user_id)
      await repo.acceptInvitations(user)
      await startSession(req, res, user)
      return { ok: true }
    },

    passkeys: async (user) => (await repo.passkeysOf(user.id)).map(p => ({ id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at })),
  }
}

export function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie')
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), cookie])
}

export function clientIp(req) {
  return req.clientIp || req.socket?.remoteAddress || 'unknown'
}
