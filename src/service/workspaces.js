// One templaitor project (+ editor API handler) per organization, cached in memory.
import { loadProject } from '../engine/project.js'
import { createHandler } from '../server/server.js'
import { decrypt } from './crypto.js'
import { safeFetch } from './netguard.js'

export function createWorkspaces({ config, repo, storage }) {
  const cache = new Map()

  /** SMTP of an org in the shape the engine expects (password decrypted) or null */
  function smtpOf(org) {
    const s = org.smtp || {}
    if (!s.host) return null
    return {
      host: s.host,
      port: Number(s.port || 587),
      secure: !!s.secure,
      user: s.user || '',
      pass: s.passEnc ? decrypt(config.secret, s.passEnc) : '',
      from: s.from || `no-reply@${config.rpId}`,
      label: 'Send test',
      web: null,
    }
  }

  return {
    smtpOf,
    get(orgId) {
      let ws = cache.get(orgId)
      if (!ws) {
        const org = repo.orgById(orgId)
        if (!org) return null
        const project = loadProject(storage.projectDir(org))
        project.smtp = smtpOf(org) // test sends use the org's SMTP, never the project file's
        project.fetchImpl = safeFetch // remote attachments: public hosts only
        ws = { org, project, handler: createHandler(project) }
        cache.set(orgId, ws)
      }
      return ws
    },
    invalidate: (orgId) => cache.delete(orgId),
  }
}
