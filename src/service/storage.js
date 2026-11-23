// Where each organization's templaitor project lives. The engine always works on a project directory:
//   fs → a folder per org (storage.dir/<slug>, or a folder mapped in storage.projects, e.g. a git checkout)
//   db → files stored in the database, materialized into storage.cacheDir/<org id> and synced back after writes
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { sha256 } from './crypto.js'

const DEMO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/demo')
const SKIP = new Set(['dist', 'node_modules', '.git'])

export function createStorage({ config, repo, log = null }) {
  const materialized = new Map() // org id → stamp of the files written to the cache

  const fsDir = (org) => config.storage.projects[org.slug] ?? path.join(config.storage.dir, org.slug)
  const isMapped = (org) => config.storage.driver === 'fs' && !!config.storage.projects[org.slug]

  const storage = {
    driver: config.storage.driver,
    isMapped,

    /** Project directory of an org, ready for the engine */
    async projectDir(org) {
      if (config.storage.driver === 'fs') return fsDir(org)
      const dir = path.join(config.storage.cacheDir, org.id)
      // another instance may have changed the files: re-materialize when the stamp changes
      const stamp = await repo.filesStamp(org.id)
      if (materialized.get(org.id) !== stamp || !fs.existsSync(dir)) {
        // written next to it and swapped, so requests in flight never see a half-written project
        const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`
        fs.mkdirSync(tmp, { recursive: true })
        for (const f of await repo.fileContents(org.id)) {
          const full = safeJoin(tmp, f.path)
          fs.mkdirSync(path.dirname(full), { recursive: true })
          fs.writeFileSync(full, Buffer.from(f.content))
        }
        const old = `${dir}.old-${process.pid}-${Date.now()}`
        if (fs.existsSync(dir)) fs.renameSync(dir, old)
        fs.renameSync(tmp, dir)
        fs.rmSync(old, { recursive: true, force: true })
        materialized.set(org.id, stamp)
      }
      return dir
    },

    /** After a write through the editor API: copy changes back to the database (db driver) */
    async sync(org) {
      if (config.storage.driver !== 'db') return 0
      const dir = await storage.projectDir(org)
      const stored = new Map((await repo.files(org.id)).map(f => [f.path, f.hash]))
      const seen = new Set()
      let changes = 0
      await repo.db.tx(async () => {
        for (const rel of walkFiles(dir)) {
          seen.add(rel)
          const content = fs.readFileSync(path.join(dir, rel))
          const hash = sha256(content)
          if (stored.get(rel) !== hash) { await repo.putFile(org.id, rel, content, hash); changes++ }
        }
        for (const rel of stored.keys()) if (!seen.has(rel)) { await repo.deleteFile(org.id, rel); changes++ }
      })
      // our own writes: the cache is already up to date
      materialized.set(org.id, await repo.filesStamp(org.id))
      return changes
    },

    /** Creates the project of a new org: `blank` (one layout + one template) or `demo` (the demo project) */
    async scaffold(org, { starter = 'blank', locales } = {}) {
      const dir = config.storage.driver === 'fs' ? fsDir(org) : path.join(config.storage.cacheDir, org.id)
      if (isMapped(org)) return dir // existing folder: nothing to create
      if (fs.existsSync(path.join(dir, 'templaitor.config.yml'))) throw new Error(`A project already exists in ${dir}`)
      fs.mkdirSync(dir, { recursive: true })
      if (starter === 'demo') {
        fs.cpSync(path.join(DEMO_DIR, 'templates'), path.join(dir, 'templates'), { recursive: true })
        const demo = YAML.parse(fs.readFileSync(path.join(DEMO_DIR, 'templaitor.config.yml'), 'utf8'))
        delete demo.smtp
        fs.writeFileSync(path.join(dir, 'templaitor.config.yml'), configYaml({ ...demo, name: org.name }))
      } else {
        const loc = locales && Object.keys(locales).length ? locales : { en: 'en-US', es: 'es-ES' }
        fs.writeFileSync(path.join(dir, 'templaitor.config.yml'), configYaml({
          name: org.name, templates: 'templates', outDir: 'dist', layouts: '_layouts', components: '_components',
          links: '_shared/links.yml', static: '_shared', locales: loc, output: { text: true, subject: true }, pdf: { engine: 'auto' },
        }))
        fs.mkdirSync(path.join(dir, 'templates/_shared'), { recursive: true })
        fs.writeFileSync(path.join(dir, 'templates/_shared/links.yml'), 'home: "{{ app_url }}"\n')
        const { loadProject, createLayout, createTemplate } = await import('../engine/project.js')
        const project = loadProject(dir)
        createLayout(project, 'base.layout')
        createTemplate(loadProject(dir), 'general/welcome', { layout: 'base.layout.mjml', langs: Object.keys(loc) })
      }
      if (config.storage.driver === 'db') { materialized.set(org.id, await repo.filesStamp(org.id)); await storage.sync(org) }
      // fs storage: the org's folder is a git repository, so template versions work from the start
      else await initGit(dir, { name: config.appName, email: `templaitor@${config.rpId}` }, log)
      return dir
    },

    /** Removes the project of a deleted org (never a mapped folder) */
    remove(org) {
      if (isMapped(org)) return
      fs.rmSync(config.storage.driver === 'fs' ? fsDir(org) : path.join(config.storage.cacheDir, org.id), { recursive: true, force: true })
      materialized.delete(org.id)
    },
  }
  return storage
}

async function initGit(dir, committer, log) {
  const { loadProject } = await import('../engine/project.js')
  const { gitVersionStore } = await import('../engine/history.js')
  try {
    await gitVersionStore(loadProject(dir), { rootMustBe: dir, committer }).init()
  } catch (e) {
    log?.(`git init of ${dir}: ${e.message} (template versions stay off until git is available)`)
  }
}

function configYaml(obj) {
  return `# templaitor project configuration (hosted)\n${YAML.stringify(obj)}`
}

function walkFiles(root) {
  const out = []
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else if (e.isFile()) out.push(r)
    }
  }
  if (fs.existsSync(root)) walk(root, '')
  return out
}

function safeJoin(root, rel) {
  const full = path.resolve(root, rel)
  if (!full.startsWith(root + path.sep)) throw new Error(`Invalid stored path: ${rel}`)
  return full
}
