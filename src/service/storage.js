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

export function createStorage({ config, repo }) {
  const materialized = new Set()

  const fsDir = (org) => config.storage.projects[org.slug] ?? path.join(config.storage.dir, org.slug)
  const isMapped = (org) => config.storage.driver === 'fs' && !!config.storage.projects[org.slug]

  const storage = {
    driver: config.storage.driver,
    isMapped,

    /** Project directory of an org, ready for the engine */
    projectDir(org) {
      if (config.storage.driver === 'fs') return fsDir(org)
      const dir = path.join(config.storage.cacheDir, org.id)
      if (!materialized.has(org.id)) {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.mkdirSync(dir, { recursive: true })
        for (const f of repo.fileContents(org.id)) {
          const full = safeJoin(dir, f.path)
          fs.mkdirSync(path.dirname(full), { recursive: true })
          fs.writeFileSync(full, Buffer.from(f.content))
        }
        materialized.add(org.id)
      }
      return dir
    },

    /** After a write through the editor API: copy changes back to the database (db driver) */
    sync(org) {
      if (config.storage.driver !== 'db') return 0
      const dir = storage.projectDir(org)
      const stored = new Map(repo.files(org.id).map(f => [f.path, f.hash]))
      const seen = new Set()
      let changes = 0
      repo.db.tx(() => {
        for (const rel of walkFiles(dir)) {
          seen.add(rel)
          const content = fs.readFileSync(path.join(dir, rel))
          const hash = sha256(content)
          if (stored.get(rel) !== hash) { repo.putFile(org.id, rel, content, hash); changes++ }
        }
        for (const rel of stored.keys()) if (!seen.has(rel)) { repo.deleteFile(org.id, rel); changes++ }
      })
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
      if (config.storage.driver === 'db') { materialized.add(org.id); storage.sync(org) }
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
