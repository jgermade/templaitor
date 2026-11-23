// Global editor state (Svelte 5 runes).
//
// Source of truth: the three template texts (mjml, yml, data). The MJML tree and
// the i18n messages are derived from them; every visual edit becomes a change to
// those texts, so the code view, saving and compiling always see exactly the
// same thing.

import YAML from 'yaml'
import JSON5 from 'json5'
import {
  parse, serialize, splitFrontmatter, joinFrontmatter, findNode, parentId, clone,
  removeNode, insertNode, moveNode, getAttr, setAttr, importCall, walk,
} from '@shared/mjml-tree.js'
import { formatImportCall, normalizeParams, toBoolean } from '@shared/imports.js'
import { splitWrapper, setHeadingLevel, rewrap } from '@shared/semantics.js'
import { normalizeAttachments } from '@shared/attachments.js'
import { COMPONENTS, canContain, describe } from '@shared/components.js'
import { logicMap, unitBounds, unitsOf, moveUnit, removeUnit, duplicateUnit, setLogic } from '@shared/logic.js'
import { normalizeContract, contractToYaml, inferContract, normalizeRules } from '@shared/contract.js'
import { api } from '../lib/api.js'
import { confirmDialog } from '../lib/dialogs.svelte.js'

const EXACT_T = /^\$t\(\s*['"]([^'"]+)['"]\s*\)$/

class EditorStore {
  project = $state(null)
  templates = $state([])
  components = $state([])
  layouts = $state([])
  assets = $state([]) // images in the static directory
  doc = $state(null) // { kind, id, name, mjml, yml, data }
  returnTo = $state(null) // template a component/layout was opened from
  saved = $state(null) // snapshot of the saved texts
  lang = $state(null)
  selectedId = $state(null)
  hoverId = $state(null)
  view = $state('design') // design | preview | text | code
  device = $state('desktop') // desktop | mobile
  preview = $state({ html: '', text: '', subject: '', warnings: [], errors: [] })
  loadingPreview = $state(false)
  toast = $state(null)
  editing = $state(null) // active editable region on the canvas
  selectSource = $state(null) // 'canvas' when the selection comes from a click on the canvas
  insertRequest = $state(null) // { src } — inserts a token into the active editable region
  lastSentUrl = $state(null) // link to the last sent email (e.g. in Mailpit)
  previewNonce = $state(0) // forces a preview reload (e.g. after editing a layout)
  pdfEngine = $state(null) // engine chosen in the PDF view (null = the template's/config's)
  pdfEngineUsed = $state(null)
  pdfValidation = $state(null) // { status: 'running' | 'done' | 'error', result, error, stale }
  history = $state([])
  future = $state([])
  /**
   * Drag and drop in progress: a node of the tree (`id`, `tag`) or a new item from the library (`item`:
   * a block or a component, see blockItem / componentItem)
   */
  drag = $state({ id: null, tag: null, item: null })

  // ── Derived ───────────────────────────────────────────────
  split = $derived(splitFrontmatter(this.doc?.mjml ?? ''))
  frontmatter = $derived.by(() => {
    try { return YAML.parse(this.split.frontmatter || '') || {} } catch { return {} }
  })
  kind = $derived(this.doc?.kind ?? 'template')
  isComponent = $derived(this.kind === 'component')
  isLayout = $derived(this.kind === 'layout')
  isTemplate = $derived(this.kind === 'template')
  /** PDF template (`format: pdf` in the frontmatter) */
  isPdf = $derived(this.isTemplate && String(this.frontmatter.format || '').toLowerCase() === 'pdf')
  pdfSettings = $derived(this.frontmatter.pdf || {})
  /** Email attachments (`attachments` in the frontmatter) */
  attachments = $derived(this.isTemplate && !this.isPdf ? normalizeAttachments(this.frontmatter.attachments) : [])
  /** Parameters declared in the frontmatter (when editing a component) */
  componentParams = $derived(normalizeParams(this.frontmatter.params))
  isFragment = $derived(!!this.frontmatter.layout || (this.isComponent && !/<mjml[\s>]/.test(this.doc?.mjml || '')))
  tree = $derived(parse(this.split.body))
  i18n = $derived.by(() => {
    try { return YAML.parse(this.doc?.yml || '') || {} } catch { return {} }
  })
  langs = $derived(Object.keys(this.i18n.messages || {}))
  messages = $derived(this.i18n.messages?.[this.lang] || {})
  demoData = $derived.by(() => {
    try { return JSON5.parse(this.doc?.data || '{}') } catch { return null }
  })
  // only the MJML of a layout is saved (texts/data belong to the preview template)
  dirty = $derived(!!this.doc && !!this.saved && (
    this.doc.mjml !== this.saved.mjml || (!this.isLayout && (this.doc.yml !== this.saved.yml || this.doc.data !== this.saved.data))
  ))
  selected = $derived(this.selectedId != null ? findNode(this.tree, this.selectedId) : null)
  /** Data contract (`data:` in the frontmatter): the data the template expects */
  hasContract = $derived(this.isTemplate && this.frontmatter.data != null)
  contract = $derived(normalizeContract(this.frontmatter.data))
  /** Jinja2 logic of the blocks (show only if / repeat for each) and the markers that hold it */
  logic = $derived(logicMap(this.tree))

  /** Keys used in the template that are missing in some language */
  missing = $derived.by(() => {
    const keys = new Set()
    for (const m of (this.doc?.mjml || '').matchAll(/\$t\(\s*['"]([^'"]+)['"]\s*\)/g)) keys.add(m[1])
    const out = []
    for (const lang of this.langs) {
      for (const k of keys) if (this.i18n.messages?.[lang]?.[k] == null) out.push({ lang, key: k })
    }
    return out
  })

  // ── Load / save ───────────────────────────────────────────
  async init() {
    this.project = await api.project()
    await this.refreshTemplates()
    const hash = decodeURIComponent(location.hash.slice(1))
    if (hash.startsWith('c:') && this.components.some(c => c.id === hash.slice(2))) return this.open(hash.slice(2), 'component')
    if (hash.startsWith('l:') && this.layouts.some(l => l.id === hash.slice(2))) return this.open(hash.slice(2), 'layout')
    const first = this.templates.find(t => t.id === hash) || this.templates[0]
    if (first) await this.open(first.id)
  }

  async refreshTemplates() {
    ;[this.templates, this.components, this.layouts, this.project, this.assets] = await Promise.all([
      api.templates(), api.components(), api.layouts(), api.project(), api.assets(),
    ])
  }

  async uploadAsset(file) {
    try {
      const saved = await api.uploadAsset(file)
      this.assets = await api.assets()
      this.notify(`Image uploaded: ${saved.path}`)
      return saved
    } catch (e) {
      this.notify(e.message, 'error')
      return null
    }
  }

  /** Resolves `{{ variable }}` with the demo data (for inspector thumbnails) */
  resolveDemo(value) {
    return String(value ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path) => {
      const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), this.demoData || {})
      return v == null ? m : String(v)
    })
  }

  /** Props for the inspector image fields */
  get imageProps() {
    return {
      assets: this.assets,
      assetsUrl: this.project?.assetsUrl ?? '',
      resolve: (v) => this.resolveDemo(v),
      onupload: (file) => this.uploadAsset(file),
    }
  }

  async open(id, kind = 'template') {
    if (this.dirty && !(await confirmDialog({
      title: 'Unsaved changes',
      message: `${this.doc.id} has unsaved changes. Discard them?`,
      okLabel: 'Discard', danger: true,
    }))) return false
    const doc = await api.template(id, kind)
    if (kind !== 'template' && this.doc?.kind === 'template') this.returnTo = this.doc.id
    if (kind === 'template') this.returnTo = null
    this.doc = doc
    this.saved = { mjml: doc.mjml, yml: doc.yml, data: doc.data }
    this.history = []
    this.future = []
    this.selectedId = null
    const langs = Object.keys(this.i18n.messages || {})
    if (!langs.includes(this.lang)) this.lang = langs[0] || this.project?.defaultLocale
    history.replaceState(null, '', `#${{ component: 'c:', layout: 'l:' }[kind] ?? ''}${encodeURIComponent(id)}`)
    return true
  }

  /** Saves the draft → true when saved */
  async save({ quiet = false } = {}) {
    if (!this.doc) return false
    try {
      const doc = await api.save({ kind: this.kind, id: this.doc.id, mjml: this.doc.mjml, yml: this.doc.yml, data: this.doc.data })
      this.saved = { mjml: doc.mjml, yml: doc.yml, data: doc.data }
      if (!quiet) this.notify(this.isTemplate ? 'Saved' : `${this.isLayout ? 'Layout' : 'Component'} saved (applies to every template using it)`)
      await this.refreshTemplates()
      return true
    } catch (e) {
      this.notify(e.message, 'error')
      return false
    }
  }

  async compile() {
    try {
      if (this.dirty) await this.save()
      const r = await api.compile(this.isTemplate ? this.doc?.id : undefined)
      const warn = r.issues.length ? ` · ${r.issues.length} warning(s)` : ''
      this.notify(`Compiled: ${r.files.length} file(s) in ${this.project.outDir}/${warn}`, r.issues.length ? 'warn' : 'success')
    } catch (e) {
      this.notify(e.message, 'error')
    }
  }

  /** Inserts a token (variable, $link…) into the text being edited, or at the end of the content */
  insertToken(src) {
    if (this.editing) {
      this.insertRequest = { src, at: Date.now() }
      return
    }
    const node = this.selected
    if (!node || node.content == null) return
    const key = this.keyOf(node)
    if (key) this.setMessage(this.lang, key, `${String(this.messages[key] ?? '').trim()} ${src}`.trim())
    else this.setContent(this.selectedId, `${node.content.trim()} ${src}`.trim())
  }

  /** Shareable URL of the saved document's preview in the current language (`/preview/<id>?lang=…`) */
  previewUrl({ version } = {}) {
    if (!this.doc) return null
    const params = new URLSearchParams({ lang: this.lang })
    if (this.kind !== 'template') params.set('kind', this.kind)
    if (version) params.set('version', version)
    return `${location.origin}/preview/${this.doc.id.split('/').map(encodeURIComponent).join('/')}?${params}`
  }

  /** Opens the preview (with demo data) in a new tab, at a URL that can be reloaded and shared */
  async openPreviewTab() {
    if (!this.doc) return
    if (this.dirty) {
      const ok = await confirmDialog({
        title: 'Save before opening the preview?',
        message: 'The preview URL shows the saved files, so it can be reloaded and shared. Your unsaved changes are saved first.',
        okLabel: 'Save and open',
      })
      if (!ok || !(await this.save({ quiet: true }))) return
    }
    window.open(this.previewUrl(), '_blank', 'noopener')
  }

  notify(message, type = 'success', link = null) {
    this.toast = { message, type, link, at: Date.now() }
  }

  // ── History ───────────────────────────────────────────────
  #lastPush = { at: 0, tag: null }

  /** Applies a change to the template texts, recording history */
  update(patch, tag = null) {
    if (!this.doc) return
    const now = Date.now()
    const coalesce = tag && tag === this.#lastPush.tag && now - this.#lastPush.at < 800
    if (!coalesce) {
      this.history = [...this.history.slice(-199), { mjml: this.doc.mjml, yml: this.doc.yml, data: this.doc.data }]
      this.future = []
    }
    this.#lastPush = { at: now, tag }
    this.doc = { ...this.doc, ...patch }
  }

  undo() {
    const prev = this.history.at(-1)
    if (!prev) return
    this.future = [...this.future, { mjml: this.doc.mjml, yml: this.doc.yml, data: this.doc.data }]
    this.history = this.history.slice(0, -1)
    this.doc = { ...this.doc, ...prev }
    this.#lastPush = { at: 0, tag: null }
    if (this.selectedId && !findNode(this.tree, this.selectedId)) this.selectedId = null
  }

  redo() {
    const next = this.future.at(-1)
    if (!next) return
    this.history = [...this.history, { mjml: this.doc.mjml, yml: this.doc.yml, data: this.doc.data }]
    this.future = this.future.slice(0, -1)
    this.doc = { ...this.doc, ...next }
    this.#lastPush = { at: 0, tag: null }
  }

  // ── MJML tree ────────────────────────────────────────────
  /** Mutates a copy of the tree and re-serializes the MJML. `fn` may return the new selected id. */
  mutate(fn, tag = null) {
    const tree = clone(this.tree)
    const result = fn(tree)
    const body = serialize(tree)
    this.update({ mjml: joinFrontmatter(this.split.frontmatter, body) }, tag)
    if (result !== undefined) this.selectedId = result
  }

  setAttr(id, name, value) {
    this.mutate(tree => { setAttr(findNode(tree, id), name, value) }, `attr:${id}:${name}`)
  }

  renameAttr(id, oldName, newName) {
    this.mutate(tree => {
      const node = findNode(tree, id)
      const a = node.attrs.find(([k]) => k === oldName)
      if (a && newName) a[0] = newName
    })
  }

  setContent(id, content, tag) {
    this.mutate(tree => { findNode(tree, id).content = content }, tag ?? `content:${id}`)
  }

  removeSelected() {
    const id = this.selectedId
    if (id == null || id === '') return
    this.mutate(tree => {
      removeUnit(tree, id) // with its {% if %} / {% for %} markers
      return null
    })
  }

  duplicate(id) {
    this.mutate(tree => duplicateUnit(tree, id))
  }

  /** Moves a block (with its logic markers) past the previous / next unit */
  move(id, delta) {
    const { pid, parent, idx } = unitBounds(this.tree, id)
    const units = unitsOf(parent.children)
    const k = units.findIndex(u => idx >= u.start && idx <= u.end)
    const other = units[k + delta]
    if (!other) return
    this.mutate(tree => moveUnit(tree, id, pid, delta > 0 ? other.end + 1 : other.start))
  }

  /** Drag and drop: places `id` before/after/inside `targetId` when valid */
  drop(id, targetId, where) {
    const target = findNode(this.tree, targetId)
    const node = findNode(this.tree, id)
    if (!target || !node || id === targetId || targetId.startsWith(`${id}.`)) return false
    let pid, index
    if (where === 'inside') {
      pid = targetId
      index = target.children.length
    } else {
      // before / after the target's unit (its logic markers stay around it)
      const u = unitBounds(this.tree, targetId)
      pid = u.pid
      index = where === 'after' ? u.end + 1 : u.start
    }
    if (!this.accepts(pid, node.tag ?? this.instanceOf(node)?.comp?.rootTag)) return false
    this.mutate(tree => moveUnit(tree, id, pid, index))
    return true
  }

  tagOf(id) {
    if (id === '' || id == null) return null
    return findNode(this.tree, id)?.tag ?? null
  }

  accepts(parentNodeId, childTag) {
    if (childTag === undefined) return true // text / command nodes: anywhere
    const ptag = this.tagOf(parentNodeId)
    if (ptag === null) return this.isFragment ? canContain(null, childTag) : childTag === 'mjml'
    if (ptag === 'mjml') return ['mj-head', 'mj-body'].includes(childTag)
    return canContain(ptag, childTag)
  }

  /** Inserts a new component at the most sensible place given the selection */
  /** A new block of the palette (texts and buttons are translatable from the start) */
  createBlock(tag) {
    const node = COMPONENTS[tag].create()
    if (COMPONENTS[tag].editable) {
      const key = this.uniqueKey(tag === 'mj-button' ? 'cta' : 'text')
      this.addMessage(key, tag === 'mj-button' ? 'Button' : 'New text')
      node.content = `$t('${key}')`
    }
    return node
  }

  add(tag) {
    const node = this.createBlock(tag)
    const placement = this.findPlacement(tag)
    if (placement) {
      this.mutate(tree => insertNode(tree, placement.pid, placement.index, node), null)
      return
    }
    // if it does not fit directly, wrap it in section > column
    let wrapped = node
    if (canContain('mj-column', tag)) wrapped = { ...COMPONENTS['mj-column'].create(), children: [node] }
    if (canContain('mj-section', wrapped.tag)) wrapped = { ...COMPONENTS['mj-section'].create(), children: [wrapped] }
    const p = this.findPlacement(wrapped.tag)
    if (!p) return this.notify(`There is nowhere to insert ${tag}`, 'error')
    this.mutate(tree => {
      const id = insertNode(tree, p.pid, p.index, wrapped)
      let leaf = id
      while (findNode(tree, leaf).tag !== tag) leaf = `${leaf}.0`
      return leaf
    }, null)
  }

  /** Page break (PDF): mj-raw with a div that forces a new page when printing */
  addPageBreak() {
    const node = { type: 'element', tag: 'mj-raw', attrs: [], children: [], content: '<div class="tpl-page-break"></div>' }
    const p = this.findPlacement('mj-section')
    if (!p) return this.notify('There is nowhere to insert the page break', 'error')
    this.mutate(tree => insertNode(tree, p.pid, p.index, node))
  }

  findPlacement(tag) {
    const bodyId = this.bodyId()
    let cur = this.selectedId ?? null
    while (cur !== null && cur !== undefined) {
      const node = findNode(this.tree, cur)
      if (node?.type === 'element' && this.accepts(cur, tag)) return { pid: cur, index: node.children.length }
      const pid = parentId(cur)
      // after the selection's unit: never between a block and its {% endif %} / {% endfor %}
      if (cur !== '' && this.accepts(pid, tag)) return { pid, index: unitBounds(this.tree, cur).end + 1 }
      if (cur === '' || cur === bodyId) break
      cur = pid
    }
    if (bodyId !== null && this.accepts(bodyId, tag)) return { pid: bodyId, index: findNode(this.tree, bodyId).children.length }
    return null
  }

  /** id of the top-level container: '' in fragments, the mj-body in full documents */
  bodyId() {
    if (this.isFragment) return ''
    const mjml = this.tree.children.findIndex(c => c.tag === 'mjml')
    if (mjml === -1) return ''
    const body = this.tree.children[mjml].children.findIndex(c => c.tag === 'mj-body')
    return body === -1 ? null : `${mjml}.${body}`
  }

  // ── Reusable components ───────────────────────────────────
  /** Info about a component instance ($import) or null */
  instanceOf(node) {
    const call = importCall(node)
    if (!call) return null
    const ref = call.path
    const comp = this.components.find(c => ref === c.importPath || ref === `${c.importPath}/${c.name}.mjml` || ref === `${c.importPath}.mjml`)
    return { ref, params: call.params, comp, name: comp?.name ?? ref.split('/').pop().replace(/\.mjml$/, '') }
  }

  /** Sets (or removes, when empty) a parameter of an instance */
  setParam(id, name, value) {
    const info = this.instanceOf(findNode(this.tree, id))
    if (!info) return
    const params = info.params.filter(([k]) => k !== name)
    const idx = info.params.findIndex(([k]) => k === name)
    if (value !== '' && value != null) params.splice(idx === -1 ? params.length : idx, 0, [name, value])
    this.mutate(tree => { findNode(tree, id).value = formatImportCall(info.ref, params) }, `param:${id}:${name}`)
  }

  // ── Parameter declarations (component frontmatter) ──
  #editFrontmatter(fn, tag) {
    const fm = YAML.parseDocument(this.split.frontmatter || '')
    if (fm.errors.length) return this.notify('The frontmatter has errors; fix it in the Code view', 'error')
    if (!fm.contents) fm.contents = fm.createNode({})
    fn(fm)
    const text = fm.toString({ lineWidth: 0 }).trim() // long values stay on one line
    this.update({ mjml: joinFrontmatter(text === '{}' ? '' : text, this.split.body) }, tag)
  }

  /** Sets (or removes, when empty) a frontmatter key, e.g. ['pdf', 'size'] */
  setFrontmatter(path, value) {
    this.#editFrontmatter(fm => {
      if (value === '' || value == null) { if (fm.hasIn(path)) fm.deleteIn(path) } else fm.setIn(path, value)
    }, `fm:${path.join('.')}`)
  }

  // ── Data contract ─────────────────────────────────────────
  /** Writes the whole contract back into the frontmatter (short form; leaf mappings in flow style) */
  setContract(contract, tag = 'contract') {
    this.#editFrontmatter((fm) => {
      const node = fm.createNode(contractToYaml(contract))
      const flow = (n) => {
        if (!n?.items) return
        n.items.forEach(p => flow(p.value))
        if (n.items.every(p => !p.value?.items)) n.flow = n.items.length > 0
      }
      node.items?.forEach(p => flow(p.value))
      fm.set('data', node)
    }, tag)
  }

  /** Fields map at `path` (names; inside a list of objects, its item fields) */
  #fieldsAt(contract, path) {
    let fields = contract
    for (const name of path) {
      const f = fields?.[name]
      fields = f?.type === 'object' ? (f.fields ??= {}) : f?.type === 'list' && f.of?.type === 'object' ? (f.of.fields ??= {}) : null
    }
    return fields
  }

  /** Changes a field: patch of { type, required, description, of } */
  updateField(path, patch) {
    const c = clone(this.contract)
    const fields = this.#fieldsAt(c, path.slice(0, -1))
    const name = path.at(-1)
    const f = { ...fields[name], ...patch }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete f[k] // a cleared rule
    // rules that do not fit the new type are dropped
    if (patch.type) {
      const keep = normalizeRules(f.type, f)
      for (const k of ['enum', 'min', 'max', 'pattern']) { if (keep[k] === undefined) delete f[k]; else f[k] = keep[k] }
    }
    if (f.type === 'object') f.fields ??= {}
    if (f.type === 'list') f.of ??= { type: 'string' }
    if (f.type !== 'object') delete f.fields
    if (f.type !== 'list') delete f.of
    if (f.type === 'list' && f.of.type === 'object') f.of.fields ??= {}
    fields[name] = f
    this.setContract(c, `contract:${path.join('.')}`)
  }

  renameField(path, newName) {
    newName = String(newName || '').trim()
    if (!/^[A-Za-z_]\w*$/.test(newName)) return this.notify(`"${newName}" is not a valid name (letters, digits and _)`, 'error')
    const c = clone(this.contract)
    const fields = this.#fieldsAt(c, path.slice(0, -1))
    if (fields[newName]) return this.notify(`${newName} already exists`, 'error')
    // keeps the order of the fields
    const entries = Object.entries(fields).map(([k, v]) => [k === path.at(-1) ? newName : k, v])
    for (const k of Object.keys(fields)) delete fields[k]
    Object.assign(fields, Object.fromEntries(entries))
    this.setContract(c)
  }

  addField(parentPath, name = null, field = { type: 'string', required: false, description: '' }) {
    const c = clone(this.contract)
    const fields = this.#fieldsAt(c, parentPath)
    let n = name || 'field'
    for (let i = 2; fields[n]; i++) n = `${name || 'field'}${i}`
    fields[n] = field
    this.setContract(c)
  }

  removeField(path) {
    const c = clone(this.contract)
    delete this.#fieldsAt(c, path.slice(0, -1))[path.at(-1)]
    this.setContract(c)
  }

  /** Contract from the demo data and the variables the template uses (keeps the fields already declared) */
  generateContract() {
    const inferred = inferContract(this.demoData || {}, this.preview.usedVars || [])
    this.setContract({ ...inferred, ...this.contract })
    this.notify(`Data contract: ${Object.keys({ ...inferred, ...this.contract }).length} field(s) — review the types`)
  }

  /** Layouts offered to templates of `format` (a layout without `format:` is offered to both) */
  layoutsFor(format) {
    return this.layouts.filter(l => !l.format || l.format === format)
  }

  setFormat(format) {
    this.#editFrontmatter(fm => {
      if (format === 'pdf') {
        fm.set('format', 'pdf')
        if (!fm.has('pdf')) fm.set('pdf', fm.createNode({ size: 'A4', orientation: 'portrait', margin: '15mm', footer: '{page} / {pages}' }))
      } else {
        fm.delete('format')
        fm.delete('pdf')
      }
    })
    if (format !== 'pdf' && this.view === 'pdf') this.view = 'preview'
    // the layout follows the format: an email layout for an email, a PDF layout for a document
    const current = this.layouts.find(l => l.id === this.frontmatter.layout)
    const next = this.layoutsFor(format)[0]
    if (current?.format && current.format !== format && next) {
      this.setLayout(next.id)
      this.notify(`Layout changed to ${next.id} (a ${format === 'pdf' ? 'PDF' : 'email'} layout)`)
    }
  }

  // ── Attachments (email frontmatter) ──
  /** Adds a local PDF template (`{ template }`) or a remote file (`{ url }`) */
  addAttachment(entry) {
    this.#editFrontmatter((fm) => {
      const node = fm.createNode(entry)
      const list = fm.get('attachments', true)
      if (YAML.isSeq(list)) list.items.push(node)
      else fm.set('attachments', fm.createNode([...(list == null ? [] : [YAML.isNode(list) ? list.toJSON() : list]), entry]))
    })
  }

  /** Sets (or removes, when empty) a field of an attachment: template · url · filename · context */
  setAttachment(index, field, value) {
    this.#editFrontmatter((fm) => {
      const list = fm.get('attachments', true)
      if (!YAML.isSeq(list) || !list.items[index]) return
      // short form (`- documents/invoice` · `- https://…`) → full form
      if (!YAML.isMap(list.items[index])) {
        const a = normalizeAttachments([list.items[index].value ?? ''])[0]
        list.items[index] = fm.createNode({ [a.type === 'url' ? 'url' : 'template']: a.ref })
      }
      const item = list.items[index]
      if (value === '' || value == null) { if (field !== 'template' && field !== 'url') item.delete(field) } else item.set(field, value)
    }, `att:${index}:${field}`)
  }

  removeAttachment(index) {
    this.#editFrontmatter((fm) => {
      const list = fm.get('attachments', true)
      if (YAML.isSeq(list)) list.items.splice(index, 1)
      if (!YAML.isSeq(list) || !list.items.length) fm.delete('attachments')
    })
  }

  /** Opens an attachment rendered with the demo data (local PDF) or its URL (remote) */
  async openAttachment(index) {
    const att = this.preview.attachments?.find(a => a.index === index)
    if (att?.type === 'url') return window.open(att.url, '_blank', 'noopener')
    const win = window.open('', '_blank')
    try {
      const blob = await api.attachment({ kind: this.kind, mjml: this.doc.mjml, yml: this.doc.yml, data: this.doc.data, lang: this.lang }, index)
      const url = URL.createObjectURL(blob)
      win.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) {
      win?.close()
      this.notify(e.message, 'error')
    }
  }

  addParamDecl(name) {
    name = name.trim()
    if (!/^[A-Za-z_][\w-]*$/.test(name)) return this.notify('Invalid parameter name (letters, digits, _ and -)', 'error')
    if (this.componentParams[name]) return this.notify(`Parameter ${name} already exists`, 'error')
    this.#editFrontmatter(fm => fm.setIn(['params', name], fm.createNode({ type: 'text', label: name, default: '' })))
  }

  setParamDecl(name, field, value) {
    this.#editFrontmatter(fm => {
      const cur = fm.getIn(['params', name], true)
      // short form (`name: value`) → full form
      if (!YAML.isMap(cur)) fm.setIn(['params', name], fm.createNode({ type: 'text', label: name, default: cur?.value ?? cur ?? '' }))
      if (value === '' || value == null || (Array.isArray(value) && !value.length)) {
        if (field !== 'default' && fm.hasIn(['params', name, field])) fm.deleteIn(['params', name, field])
        else if (field === 'default') fm.setIn(['params', name, field], '')
      } else {
        fm.setIn(['params', name, field], Array.isArray(value) ? fm.createNode(value, { flow: true }) : value)
      }
      // when switching to boolean, the default value is normalized to true/false
      if (field === 'type' && value === 'boolean') fm.setIn(['params', name, 'default'], !!toBoolean(fm.getIn(['params', name, 'default'])))
    }, `pdecl:${name}:${field}`)
  }

  removeParamDecl(name) {
    this.#editFrontmatter(fm => {
      fm.deleteIn(['params', name])
      if (!fm.get('params')?.items?.length) fm.delete('params')
    })
  }

  // ── Library items (blocks and components dragged to the canvas or the structure) ──
  /** A palette block: it can also land wrapped in a column / section where it does not fit directly */
  blockItem(tag) {
    const tags = [tag]
    let cur = tag
    if (cur !== 'mj-column' && canContain('mj-column', cur)) tags.push((cur = 'mj-column'))
    if (cur !== 'mj-section' && canContain('mj-section', cur)) tags.push('mj-section')
    return { kind: 'block', tag, tags, label: describe(tag).label }
  }

  componentItem(comp) {
    return { kind: 'component', comp, tags: [comp.rootTag], label: comp.name }
  }

  /** The tag the item takes when placed inside `pid` (itself or a wrapper), or null */
  fitIn(item, pid) {
    return item.tags.find(t => this.accepts(pid, t)) ?? null
  }

  /** Where an item may be dropped → { [nodeId]: { before, after, inside } } (canvas drag and drop) */
  dropTargets(item) {
    const out = {}
    const visit = (node) => {
      // elements, and component instances ($import text nodes, drawn as one block on the canvas)
      if (node.id != null && (node.type === 'element' || this.instanceOf(node))) {
        const sibling = !!this.fitIn(item, parentId(node.id))
        const inside = node.type === 'element' && node.content == null && !!this.fitIn(item, node.id)
        if (sibling || inside) out[node.id] = { before: sibling, after: sibling, inside }
      }
      if (node.type === 'element' && node.content == null) node.children?.forEach(visit)
    }
    this.tree.children.forEach(visit)
    return out
  }

  /** Drops a library item before/after/inside `targetId` → true when it fits there */
  dropItem(item, targetId, where) {
    const target = findNode(this.tree, targetId)
    if (!target) return false
    const u = where === 'inside' ? null : unitBounds(this.tree, targetId)
    const pid = where === 'inside' ? targetId : u.pid
    const index = where === 'inside' ? target.children.length : where === 'after' ? u.end + 1 : u.start
    const as = this.fitIn(item, pid)
    if (!as) return false
    if (item.kind === 'component') {
      this.mutate(tree => insertNode(tree, pid, index, { type: 'text', value: `$import(${item.comp.importPath})` }))
    } else {
      let node = this.createBlock(item.tag)
      if (as !== item.tag) {
        if (canContain('mj-column', node.tag)) node = { ...COMPONENTS['mj-column'].create(), children: [node] }
        if (as === 'mj-section' && node.tag !== 'mj-section') node = { ...COMPONENTS['mj-section'].create(), children: [node] }
      }
      this.mutate(tree => {
        let leaf = insertNode(tree, pid, index, node)
        while (findNode(tree, leaf).tag !== item.tag) leaf = `${leaf}.0`
        return leaf
      })
    }
    this.notify(`${item.label} added`)
    return true
  }

  /** Show only if / repeat for each of a block → { if, for } */
  logicOf(id) {
    return this.logic.byId[id] ?? { if: null, for: null }
  }

  /** Sets the Jinja2 logic of a block (rewrites its {% if %} / {% for %} markers); the selection follows it */
  setLogic(id, logic) {
    try {
      this.mutate(tree => setLogic(tree, id, logic), null)
    } catch (e) {
      this.notify(e.message, 'error')
    }
  }

  /** Keyboard alternative to dragging: inserts the component next to the selection */
  insertComponent(comp) {
    const node = { type: 'text', value: `$import(${comp.importPath})` }
    const p = this.findPlacement(comp.rootTag)
    if (!p) return this.notify(`There is nowhere to insert ${comp.name}`, 'error')
    this.mutate(tree => insertNode(tree, p.pid, p.index, node))
  }

  async openComponent(compId) {
    if (this.dirty) await this.save()
    await this.open(compId, 'component')
  }

  async openLayout(id) {
    if (this.dirty) await this.save()
    await this.open(id, 'layout')
  }

  async back() {
    if (!this.returnTo) return
    if (this.dirty) await this.save()
    await this.open(this.returnTo)
  }

  /** $t keys used inside a subtree */
  keysIn(node) {
    const keys = new Set()
    walk(node, (n) => {
      const text = [n.content, n.value, ...(n.attrs || []).map(a => a[1])].filter(Boolean).join(' ')
      for (const m of text.matchAll(/\$t\(\s*['"]([^'"]+)['"]\s*\)/g)) keys.add(m[1])
    })
    return [...keys]
  }

  /** Turns the selected block into a reusable component and replaces it with an instance */
  async extractComponent(id, name) {
    const node = findNode(this.tree, id)
    if (!node || node.type !== 'element') return
    const keys = this.keysIn(node)
    const messages = Object.fromEntries(this.langs.map(l => [l, Object.fromEntries(
      keys.filter(k => this.i18n.messages?.[l]?.[k] != null).map(k => [k, this.i18n.messages[l][k]]),
    )]))
    try {
      const comp = await api.createComponent({
        id: name,
        mjml: serialize({ type: 'root', children: [node] }),
        yml: YAML.stringify({ messages }),
      })
      await this.refreshTemplates()
      const info = this.components.find(c => c.id === comp.id)
      this.mutate(tree => {
        findNode(tree, parentId(id)).children.splice(Number(id.split('.').pop()), 1, { type: 'text', value: `$import(${info.importPath})` })
        return id
      })
      // the texts move to the component (unless the template still uses them)
      const stillUsed = new Set(this.keysIn(this.tree))
      const moved = keys.filter(k => !stillUsed.has(k))
      if (moved.length) this.#editYaml(doc => { for (const l of this.langs) for (const k of moved) doc.deleteIn(['messages', l, k]) })
      this.notify(`Component "${comp.id}" created`)
    } catch (e) {
      this.notify(e.message, 'error')
    }
  }

  /** Replaces an instance with an editable copy of its content (and copies its texts to the template) */
  async detach(id) {
    const info = this.instanceOf(findNode(this.tree, id))
    if (!info?.comp) return
    const comp = await api.template(info.comp.id, 'component')
    const parsed = parse(splitFrontmatter(comp.mjml).body)
    let compMsgs = {}
    try { compMsgs = YAML.parse(comp.yml || '')?.messages || {} } catch {}
    this.mutate(tree => {
      findNode(tree, parentId(id)).children.splice(Number(id.split('.').pop()), 1, ...parsed.children)
      return id
    })
    const keys = this.keysIn(parsed)
    this.#editYaml(doc => {
      for (const l of this.langs) for (const k of keys) {
        const v = compMsgs[l]?.[k]
        if (v != null && !doc.hasIn(['messages', l, k])) doc.setIn(['messages', l, k], v)
      }
    })
  }

  // ── i18n ──────────────────────────────────────────────────
  #editYaml(fn, tag) {
    const doc = YAML.parseDocument(this.doc.yml || '')
    if (doc.errors.length) return this.notify('The YAML has errors; fix it in the Code view', 'error')
    if (!doc.contents) doc.contents = doc.createNode({})
    fn(doc)
    this.update({ yml: doc.toString() }, tag)
  }

  setMessage(lang, key, value) {
    this.#editYaml(doc => setScalar(doc, ['messages', lang, key], value), `msg:${lang}:${key}`)
  }

  setSubject(lang, value) {
    this.#editYaml(doc => setScalar(doc, ['subject', lang], value), `subject:${lang}`)
  }

  addMessage(key, value) {
    this.#editYaml(doc => {
      for (const l of this.langs.length ? this.langs : [this.lang]) {
        if (!doc.hasIn(['messages', l, key])) doc.setIn(['messages', l, key], value)
      }
    })
  }

  renameKey(oldKey, newKey) {
    if (!newKey || oldKey === newKey) return
    if (this.langs.some(l => this.i18n.messages?.[l]?.[newKey] != null)) return this.notify(`Key ${newKey} already exists`, 'error')
    const yml = (() => {
      const doc = YAML.parseDocument(this.doc.yml || '')
      for (const l of this.langs) {
        const map = doc.getIn(['messages', l], true)
        const pair = map?.items?.find(p => String(p.key?.value ?? p.key) === oldKey)
        if (pair) pair.key = doc.createNode(newKey)
      }
      return doc.toString()
    })()
    const re = new RegExp(`\\$t\\(\\s*(['"])${oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1\\s*\\)`, 'g')
    this.update({ yml, mjml: this.doc.mjml.replace(re, `$t('${newKey}')`) })
  }

  removeKey(key) {
    this.#editYaml(doc => { for (const l of this.langs) if (doc.hasIn(['messages', l, key])) doc.deleteIn(['messages', l, key]) })
  }

  uniqueKey(base) {
    const all = new Set(this.langs.flatMap(l => Object.keys(this.i18n.messages?.[l] || {})))
    let i = 1
    while (all.has(`${base}_${i}`)) i++
    return `${base}_${i}`
  }

  addLang(lang, copyFrom) {
    if (!lang || this.langs.includes(lang)) return
    this.#editYaml(doc => {
      const src = this.i18n.messages?.[copyFrom] || {}
      doc.setIn(['messages', lang], doc.createNode({ ...src }))
      const subj = this.i18n.subject?.[copyFrom]
      if (subj != null) doc.setIn(['subject', lang], subj)
    })
    this.lang = lang
  }

  async removeLang(lang) {
    if (!(await confirmDialog({
      title: `Remove language "${lang}"`,
      message: 'All its translations and its subject will be deleted.',
      okLabel: 'Remove', danger: true,
    }))) return
    this.#editYaml(doc => {
      doc.deleteIn(['messages', lang])
      if (doc.hasIn(['subject', lang])) doc.deleteIn(['subject', lang])
    })
    if (this.lang === lang) this.lang = this.langs.find(l => l !== lang)
  }

  /** $t key when the node content is exactly $t('key') */
  keyOf(node) {
    if (node?.content == null) return null
    const inner = splitWrapper(node.content)?.inner ?? node.content
    return inner.trim().match(EXACT_T)?.[1] ?? null
  }

  /** Heading level of an mj-text (0 = paragraph) */
  setHeading(id, level) {
    const node = findNode(this.tree, id)
    this.setContent(id, setHeadingLevel(node.content, level), null)
  }

  /** Inline edit of literal content: keeps the <hN>/<p> wrapper */
  setInner(id, inner) {
    const node = findNode(this.tree, id)
    this.setContent(id, rewrap(node.content, inner))
  }

  makeTranslatable(id) {
    const node = findNode(this.tree, id)
    const key = this.uniqueKey(node.tag === 'mj-button' ? 'cta' : 'text')
    const wrap = splitWrapper(node.content)
    this.addMessage(key, (wrap ? wrap.inner : node.content).trim())
    this.setContent(id, wrap ? rewrap(node.content, `$t('${key}')`) : `$t('${key}')`, null)
  }

  inlineTranslation(id) {
    const node = findNode(this.tree, id)
    const key = this.keyOf(node)
    this.setContent(id, rewrap(node.content, String(this.messages[key] ?? '').trim()), null)
  }

  setLayout(layout) {
    if (!this.isFragment && layout) {
      return this.notify('To use a layout the template must be a fragment (no <mjml>). Edit it in the Code view.', 'error')
    }
    const fm = YAML.parseDocument(this.split.frontmatter || '')
    if (!fm.contents) fm.contents = fm.createNode({})
    if (layout) fm.set('layout', layout)
    else fm.delete('layout')
    const fmText = fm.toString().trim()
    if (!layout && !this.isFragment) return
    if (!layout) return this.notify('Removing the layout would leave the template without <mjml>; do it in the Code view.', 'error')
    this.update({ mjml: joinFrontmatter(fmText === '{}' ? '' : fmText, this.split.body) })
  }
}

function setScalar(doc, path, value) {
  const node = doc.getIn(path, true)
  if (node && YAML.isScalar(node)) {
    // keeps the style (e.g. `>` blocks) unless the text prevents it
    node.value = value
    if ((node.type === 'BLOCK_FOLDED' || node.type === 'BLOCK_LITERAL') && !value) node.type = 'PLAIN'
  } else {
    doc.setIn(path, value)
  }
}

export const store = new EditorStore()
export { getAttr }
