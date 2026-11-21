// Compare mode: the current draft (B) against a base (A): the saved version, a git commit or another
// template/component. Each side has its own language; previews are rendered by the engine API.
import YAML from 'yaml'
import { api } from '../lib/api.js'
import { store } from './editor.svelte.js'

class CompareStore {
  /** saved · git:<rev> · doc:<kind>:<id> */
  source = $state('saved')
  loaded = $state(null) // base loaded from git or another document: { label, kind, id, mjml, yml, data }
  history = $state({ git: false, commits: [], dirty: false })
  langA = $state(null)
  sameData = $state(false)
  tab = $state('visual') // visual · code
  codeTab = $state('mjml') // mjml · yml · data · text · html
  visual = $state('side') // side · overlay · difference · swipe
  amount = $state(50) // overlay opacity / swipe position (%)
  loading = $state(false)
  error = $state('')
  forDoc = $state(null) // "kind:id" the state belongs to

  /** Side A (base) */
  base = $derived.by(() => {
    if (this.source === 'saved') return store.saved ? { label: 'Saved version', short: 'saved', ...store.saved } : null
    return this.loaded
  })
  langsA = $derived.by(() => {
    try { return Object.keys(YAML.parse(this.base?.yml || '')?.messages || {}) } catch { return [] }
  })
  /** Language actually used for A (falls back to its first language) */
  effectiveLangA = $derived(this.langsA.includes(this.langA) ? this.langA : this.langsA.includes(store.lang) ? store.lang : this.langsA[0] ?? store.lang)

  /** Called when the compare view opens or the document changes */
  async prepare() {
    const key = `${store.kind}:${store.doc?.id}`
    if (this.forDoc === key) return
    this.forDoc = key
    this.loaded = null
    this.error = ''
    this.langA = null
    this.source = 'saved'
    try {
      this.history = await api.history(store.doc.id, store.kind)
    } catch {
      this.history = { git: false, commits: [] }
    }
    // default base: unsaved changes → the saved version; otherwise the last commit
    if (!store.dirty && this.history.commits[0]) await this.setSource(`git:${this.history.commits[0].rev}`)
  }

  async setSource(value) {
    this.error = ''
    if (value === 'saved') { this.source = 'saved'; this.loaded = null; return }
    this.loading = true
    try {
      if (value.startsWith('git:')) {
        const rev = value.slice(4)
        const c = this.history.commits.find(x => x.rev === rev)
        const v = await api.version(store.doc.id, store.kind, rev)
        this.loaded = { label: c ? `${c.short} · ${c.subject}` : rev.slice(0, 7), short: c?.short ?? rev.slice(0, 7), kind: store.kind, id: store.doc.id, mjml: v.mjml, yml: v.yml, data: v.data }
      } else {
        const [, kind, ...rest] = value.split(':')
        const id = rest.join(':')
        const d = await api.template(id, kind)
        this.loaded = { label: `${kind === 'component' ? '◆' : kind === 'layout' ? '⧉' : '@'} ${id}`, short: id, kind, id, mjml: d.mjml, yml: d.yml, data: d.data }
      }
      this.source = value
    } catch (e) {
      this.error = e.message
    } finally {
      this.loading = false
    }
  }
}

export const compare = new CompareStore()
