// Hosted-service configuration: templaitor.server.yml (optional) + environment variables.
//
//   baseUrl: https://templaitor.example.com     # public URL (passkeys and links depend on it)
//   port: 3000
//   dataDir: ./data                              # SQLite database, org projects (fs) and caches
//   secret: …                                    # or TEMPLAITOR_SECRET (≥ 32 chars): encrypts SMTP passwords
//   trustProxy: false                            # true behind a reverse proxy (X-Forwarded-For)
//   signup: open                                 # open · invite (only invited emails can sign in)
//   database:
//     driver: sqlite                             # sqlite (file in dataDir) · postgres
//     file: templaitor.db                        # sqlite
//     url: postgres://user:pass@host:5432/db      # postgres (or TEMPLAITOR_DATABASE_URL)
//   storage:
//     driver: fs                                 # fs (a project folder per org) · db (files in the database)
//     dir: orgs                                  # fs: folder holding one project per org (relative to dataDir)
//     projects:                                  # fs: orgs mapped to existing folders (e.g. git checkouts)
//       acme: /srv/acme/emails
//   smtp:                                        # service emails (sign-in codes, invitations)
//     host: smtp.example.com
//     port: 587
//     secure: false
//     user: templaitor
//     pass: …                                    # or TEMPLAITOR_SMTP_PASS
//     from: "templaitor <no-reply@example.com>"
//   project: .                                   # project mode (or TEMPLAITOR_PROJECT): serve ONE templaitor project —
//                                                #   e.g. the templates of the repository being deployed — read-only, as the
//                                                #   organization "project"; no other organizations can be created
//   apiKeys: [ … ]                               # project mode (or TEMPLAITOR_API_KEYS, comma separated, ≥ 24 chars
//                                                #   each): API keys for /v1/*, besides those created in the UI
//   admins: [ ops@example.com ]                  # project mode (or TEMPLAITOR_ADMINS): owners of the project
//                                                #   (send log, SMTP, API keys); the system `smtp` sends its emails
//   send:
//     maxAttempts: 6
//     rateLimitPerMinute: 120                    # per organization (API sends)
//     retentionDays: 30                          # then the HTML/text/attachments of sent messages are purged (0 = keep)

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const CONFIG_FILES = ['templaitor.server.yml', 'templaitor.server.yaml']

export function loadServiceConfig({ cwd = process.cwd(), file, env = process.env, overrides = {} } = {}) {
  let raw = {}
  const candidates = file ? [path.resolve(cwd, file)] : CONFIG_FILES.map(f => path.join(cwd, f))
  for (const f of candidates) {
    if (fs.existsSync(f)) { raw = YAML.parse(fs.readFileSync(f, 'utf8')) || {}; break }
    if (file) throw new Error(`Configuration file not found: ${f}`)
  }
  raw = deepMerge(raw, overrides)

  const port = Number(env.PORT || raw.port || 3000)
  const dataDir = path.resolve(cwd, env.TEMPLAITOR_DATA_DIR || raw.dataDir || 'data')
  const baseUrl = String(env.TEMPLAITOR_BASE_URL || raw.baseUrl || `http://localhost:${port}`).replace(/\/+$/, '')
  const secret = env.TEMPLAITOR_SECRET || raw.secret || ''
  if (secret.length < 32) throw new Error('TEMPLAITOR_SECRET (or `secret`) must have at least 32 characters')

  const storage = raw.storage || {}
  const smtp = raw.smtp || (env.TEMPLAITOR_SMTP_HOST ? {} : null)
  const smtpConfig = smtp ? {
    host: env.TEMPLAITOR_SMTP_HOST || smtp.host,
    port: Number(env.TEMPLAITOR_SMTP_PORT || smtp.port || 587),
    secure: String(env.TEMPLAITOR_SMTP_SECURE ?? smtp.secure ?? 'false') === 'true',
    user: env.TEMPLAITOR_SMTP_USER || smtp.user || '',
    pass: env.TEMPLAITOR_SMTP_PASS || smtp.pass || '',
    from: env.TEMPLAITOR_SMTP_FROM || smtp.from || 'templaitor <no-reply@localhost>',
  } : null

  const url = new URL(baseUrl)
  const project = projectConfig(raw, env, cwd)
  const cfg = {
    port,
    host: env.HOST || raw.host || '0.0.0.0',
    baseUrl,
    rpId: url.hostname,
    secure: url.protocol === 'https:',
    dataDir,
    secret,
    // behind a reverse proxy: take the client IP from X-Forwarded-For (rate limits)
    trustProxy: String(env.TEMPLAITOR_TRUST_PROXY ?? raw.trustProxy ?? 'false') === 'true',
    signup: (env.TEMPLAITOR_SIGNUP || raw.signup || (project ? 'invite' : 'open')) === 'invite' ? 'invite' : 'open', // project mode: invite by default
    appName: raw.appName || 'templaitor',
    project,
    database: databaseConfig(raw.database || {}, env, dataDir),
    storage: {
      driver: (env.TEMPLAITOR_STORAGE || storage.driver || 'fs') === 'db' ? 'db' : 'fs',
      dir: path.resolve(dataDir, storage.dir || 'orgs'),
      cacheDir: path.resolve(dataDir, storage.cacheDir || 'cache'),
      projects: Object.fromEntries(Object.entries(storage.projects || {}).map(([slug, dir]) => [slug, path.resolve(cwd, dir)])),
    },
    smtp: smtpConfig?.host ? smtpConfig : null,
    send: {
      maxAttempts: Number(raw.send?.maxAttempts || 6),
      rateLimitPerMinute: Number(raw.send?.rateLimitPerMinute || 120),
      retentionDays: Number(env.TEMPLAITOR_RETENTION_DAYS ?? raw.send?.retentionDays ?? 30),
    },
  }
  if (project) {
    // the project is served from its folder (fs storage, mapped to the organization "project")
    cfg.storage.driver = 'fs'
    cfg.storage.projects[project.slug] = project.dir
  }
  return cfg
}

function projectConfig(raw, env, cwd) {
  const dir = env.TEMPLAITOR_PROJECT || raw.project
  if (!dir) return null
  const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map(s => String(s).trim()).filter(Boolean)
  const apiKeys = list(env.TEMPLAITOR_API_KEYS ?? raw.apiKeys)
  for (const k of apiKeys) if (k.length < 24) throw new Error('Each project API key (TEMPLAITOR_API_KEYS) needs at least 24 characters')
  return {
    dir: path.resolve(cwd, dir),
    slug: 'project',
    apiKeys,
    admins: list(env.TEMPLAITOR_ADMINS ?? raw.admins).map(e => e.toLowerCase()),
  }
}

function databaseConfig(db, env, dataDir) {
  const url = env.TEMPLAITOR_DATABASE_URL || db.url || ''
  const driver = String(env.TEMPLAITOR_DATABASE || db.driver || (url ? 'postgres' : 'sqlite')).toLowerCase()
  if (!['sqlite', 'postgres'].includes(driver)) throw new Error(`Unknown database driver: ${driver} (sqlite · postgres)`)
  if (driver === 'postgres' && !url) throw new Error('database.url (or TEMPLAITOR_DATABASE_URL) is required with Postgres')
  return { driver, url, file: path.resolve(dataDir, db.file || 'templaitor.db') }
}

function deepMerge(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v
  }
  return out
}
