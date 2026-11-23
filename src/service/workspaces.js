// One templaitor project (+ editor API handler) per organization, cached in memory.
import { loadProject } from '../engine/project.js'
import { createHandler } from '../server/server.js'
import { decrypt } from './crypto.js'
import { safeFetch } from './netguard.js'
import { gitVersionStore } from '../engine/history.js'
import { autoVersionStore } from '../engine/versions.js'
import { dbVersionStore } from './versions.js'

export function createWorkspaces({ config, repo, storage }) {
  const cache = new Map()
  const loading = new Map()

  /** SMTP of an org in the shape the engine expects (password decrypted) or null */
  function smtpOf(org) {
    const s = org.smtp || {}
    // project mode: the deployment's SMTP (TEMPLAITOR_SMTP_*) unless the project has its own
    if (!s.host && config.project && org.slug === config.project.slug && config.smtp?.host) {
      return { ...config.smtp, label: 'Send test', web: null }
    }
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
    async get(orgId) {
      if (cache.has(orgId)) {
        // other instances may have changed the org (SMTP) or its files (db storage)
        const ws = cache.get(orgId)
        const org = await repo.orgById(orgId)
        if (!org) { cache.delete(orgId); return null }
        ws.org = org
        ws.project.smtp = smtpOf(org)
        if (storage.driver === 'db') await storage.projectDir(org)
        return ws
      }
      // concurrent first requests share the same load
      if (!loading.has(orgId)) {
        loading.set(orgId, (async () => {
          const org = await repo.orgById(orgId)
          if (!org) return null
          const project = loadProject(await storage.projectDir(org))
          project.smtp = smtpOf(org) // test sends use the org's SMTP, never the project file's
          project.fetchImpl = safeFetch // remote attachments: public hosts only
          // versions: database rows (db storage) or git commits in the org's own folder (fs storage; a mapped
          // folder may live inside a larger checkout, any other folder must be its own repository)
          project.versionStore = storage.driver === 'db'
            ? dbVersionStore({ repo, orgId: org.id })
            : storage.isMapped(org)
              ? autoVersionStore(project, { committer: { name: config.appName, email: `templaitor@${config.rpId}` } }) // a checkout, or a snapshot without .git
              : gitVersionStore(project, { rootMustBe: project.cwd, committer: { name: config.appName, email: `templaitor@${config.rpId}` } })
          const ws = { org, project, handler: createHandler(project) }
          cache.set(orgId, ws)
          return ws
        })().finally(() => loading.delete(orgId)))
      }
      return loading.get(orgId)
    },
    invalidate: (orgId) => cache.delete(orgId),
  }
}
