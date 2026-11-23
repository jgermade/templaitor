// Versions of the open document: list, save a version, restore one into the draft, compare with one.
// The server decides the storage: git commits (local editor, hosted `fs` storage) or database rows (hosted `db`).
import { api } from '../lib/api.js'
import { store } from './editor.svelte.js'
import { compare } from './compare.svelte.js'
import { confirmDialog } from '../lib/dialogs.svelte.js'

class VersionsStore {
  data = $state({ backend: null, available: false, canInit: false, dirty: false, versions: [] })
  loading = $state(false)
  busy = $state(false)
  error = $state('')
  forDoc = $state(null) // "kind:id" the list belongs to

  latest = $derived(this.data.versions[0] ?? null)
  /** draft or saved files differ from the latest version */
  pending = $derived(store.dirty || this.data.dirty)

  async load() {
    if (!store.doc) return
    const key = `${store.kind}:${store.doc.id}`
    this.loading = true
    this.error = ''
    try {
      const data = await api.versions(store.doc.id, store.kind)
      if (key === `${store.kind}:${store.doc?.id}`) { this.data = data; this.forDoc = key }
    } catch (e) {
      this.error = e.message
    } finally {
      this.loading = false
    }
  }

  /** Saves the draft (if needed) and records it as a new version */
  async save(message) {
    this.busy = true
    this.error = ''
    try {
      if (store.dirty && !(await store.save({ quiet: true }))) return null
      const v = await api.saveVersion(store.doc.id, store.kind, message)
      store.notify(`Version ${v.number ? `v${v.number}` : v.short} saved`)
      compare.forDoc = null // the compare view reloads its list of versions
      await this.load()
      return v
    } catch (e) {
      this.error = e.message
      return null
    } finally {
      this.busy = false
    }
  }

  /** Local project without git: `git init` + a first commit of the whole project */
  async init() {
    this.busy = true
    this.error = ''
    try {
      await api.initVersions()
      store.notify('Git repository created: every document has its first version')
      compare.forDoc = null
      await this.load()
    } catch (e) {
      this.error = e.message
    } finally {
      this.busy = false
    }
  }

  /** Loads a version into the draft (unsaved: undo reverts it, Save keeps it) */
  async restore(v) {
    const label = this.label(v)
    if (store.dirty && !(await confirmDialog({
      title: `Restore ${label}?`,
      message: 'The draft has unsaved changes. Restoring replaces the draft; Undo (Ctrl+Z) brings it back.',
      okLabel: 'Restore',
    }))) return false
    this.busy = true
    try {
      const old = await api.version(store.doc.id, store.kind, v.rev)
      const patch = { mjml: old.mjml }
      if (!store.isLayout) {
        if (old.yml != null) patch.yml = old.yml
        if (old.data != null) patch.data = old.data
      }
      store.update(patch, 'restore-version')
      store.notify(`${label} restored into the draft — save to keep it`)
      return true
    } catch (e) {
      store.notify(e.message, 'error')
      return false
    } finally {
      this.busy = false
    }
  }

  /** Opens the compare view with this version as the base (A) */
  async compareWith(v) {
    store.view = 'compare'
    await compare.prepare()
    await compare.setSource(`ver:${v.rev}`)
  }

  label = (v) => (v.number ? `v${v.number}` : v.short)
}

export const versions = new VersionsStore()
