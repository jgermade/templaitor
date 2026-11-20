// Estado global del editor (Svelte 5 runes).
//
// Fuente de verdad: los tres textos de la plantilla (mjml, yml, data). El árbol
// MJML y los mensajes i18n se derivan de ellos; toda edición visual se traduce
// a una modificación de esos textos, de modo que la vista de código, el
// guardado y la compilación siempre ven exactamente lo mismo.

import YAML from 'yaml'
import JSON5 from 'json5'
import {
  parse, serialize, splitFrontmatter, joinFrontmatter, findNode, parentId, clone,
  removeNode, insertNode, moveNode, getAttr, setAttr, importCall, walk,
} from '@shared/mjml-tree.js'
import { formatImportCall, normalizeParams } from '@shared/imports.js'
import { COMPONENTS, canContain } from '@shared/components.js'
import { api } from '../lib/api.js'

const EXACT_T = /^\$t\(\s*['"]([^'"]+)['"]\s*\)$/

class EditorStore {
  project = $state(null)
  templates = $state([])
  components = $state([])
  doc = $state(null) // { kind, id, name, mjml, yml, data }
  returnTo = $state(null) // plantilla desde la que se abrió un componente
  saved = $state(null) // snapshot de lo guardado
  lang = $state(null)
  selectedId = $state(null)
  hoverId = $state(null)
  view = $state('design') // design | preview | text | code
  device = $state('desktop') // desktop | mobile
  preview = $state({ html: '', text: '', subject: '', warnings: [], errors: [] })
  loadingPreview = $state(false)
  toast = $state(null)
  editing = $state(null) // región editable activa en el lienzo
  selectSource = $state(null) // 'canvas' si la selección viene de un click en el lienzo
  insertRequest = $state(null) // { src } — inserta un token en la región editable activa
  previewNonce = $state(0) // fuerza recargar la vista previa (p.ej. tras editar un layout)
  history = $state([])
  future = $state([])

  // ── Derivados ─────────────────────────────────────────────
  split = $derived(splitFrontmatter(this.doc?.mjml ?? ''))
  frontmatter = $derived.by(() => {
    try { return YAML.parse(this.split.frontmatter || '') || {} } catch { return {} }
  })
  kind = $derived(this.doc?.kind ?? 'template')
  isComponent = $derived(this.kind === 'component')
  /** Parámetros declarados en el frontmatter (al editar un componente) */
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
  dirty = $derived(!!this.doc && !!this.saved && (
    this.doc.mjml !== this.saved.mjml || this.doc.yml !== this.saved.yml || this.doc.data !== this.saved.data
  ))
  selected = $derived(this.selectedId != null ? findNode(this.tree, this.selectedId) : null)

  /** Claves usadas en la plantilla que faltan en algún idioma */
  missing = $derived.by(() => {
    const keys = new Set()
    for (const m of (this.doc?.mjml || '').matchAll(/\$t\(\s*['"]([^'"]+)['"]\s*\)/g)) keys.add(m[1])
    const out = []
    for (const lang of this.langs) {
      for (const k of keys) if (this.i18n.messages?.[lang]?.[k] == null) out.push({ lang, key: k })
    }
    return out
  })

  // ── Carga / guardado ──────────────────────────────────────
  async init() {
    this.project = await api.project()
    await this.refreshTemplates()
    const hash = decodeURIComponent(location.hash.slice(1))
    if (hash.startsWith('c:') && this.components.some(c => c.id === hash.slice(2))) return this.open(hash.slice(2), 'component')
    const first = this.templates.find(t => t.id === hash) || this.templates[0]
    if (first) await this.open(first.id)
  }

  async refreshTemplates() {
    ;[this.templates, this.components, this.project] = await Promise.all([api.templates(), api.components(), api.project()])
  }

  async open(id, kind = 'template') {
    if (this.dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return false
    const doc = await api.template(id, kind)
    if (kind === 'component' && this.doc?.kind === 'template') this.returnTo = this.doc.id
    if (kind === 'template') this.returnTo = null
    this.doc = doc
    this.saved = { mjml: doc.mjml, yml: doc.yml, data: doc.data }
    this.history = []
    this.future = []
    this.selectedId = null
    const langs = Object.keys(this.i18n.messages || {})
    if (!langs.includes(this.lang)) this.lang = langs[0] || this.project?.defaultLocale
    history.replaceState(null, '', `#${kind === 'component' ? 'c:' : ''}${encodeURIComponent(id)}`)
    return true
  }

  async save() {
    if (!this.doc) return
    try {
      const doc = await api.save({ kind: this.kind, id: this.doc.id, mjml: this.doc.mjml, yml: this.doc.yml, data: this.doc.data })
      this.saved = { mjml: doc.mjml, yml: doc.yml, data: doc.data }
      this.notify(this.isComponent ? 'Componente guardado (se aplica en todas las plantillas que lo usan)' : 'Guardado')
      await this.refreshTemplates()
    } catch (e) {
      this.notify(e.message, 'error')
    }
  }

  async compile() {
    try {
      if (this.dirty) await this.save()
      const r = await api.compile(this.isComponent ? undefined : this.doc?.id)
      const warn = r.issues.length ? ` · ${r.issues.length} aviso(s)` : ''
      this.notify(`Compilado: ${r.files.length} fichero(s) en ${this.project.outDir}/${warn}`, r.issues.length ? 'warn' : 'success')
    } catch (e) {
      this.notify(e.message, 'error')
    }
  }

  /** Inserta un token (variable, $link…) en el texto que se está editando, o al final del contenido */
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

  notify(message, type = 'success', link = null) {
    this.toast = { message, type, link, at: Date.now() }
  }

  // ── Historial ─────────────────────────────────────────────
  #lastPush = { at: 0, tag: null }

  /** Aplica un cambio a los textos de la plantilla, registrando historial */
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

  // ── Árbol MJML ────────────────────────────────────────────
  /** Muta una copia del árbol y re-serializa el MJML. `fn` puede devolver el nuevo id seleccionado. */
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
      removeNode(tree, id)
      return null
    })
  }

  duplicate(id) {
    this.mutate(tree => {
      const node = findNode(tree, id)
      const pid = parentId(id)
      const idx = Number(id.split('.').pop())
      return insertNode(tree, pid, idx + 1, clone(node))
    })
  }

  move(id, delta) {
    const pid = parentId(id)
    const idx = Number(id.split('.').pop())
    const parent = findNode(this.tree, pid)
    const target = idx + delta
    if (target < 0 || target >= parent.children.length) return
    this.mutate(tree => moveNode(tree, id, pid, delta > 0 ? target + 1 : target))
  }

  /** Arrastrar y soltar: coloca `id` antes/después/dentro de `targetId` si es válido */
  drop(id, targetId, where) {
    const target = findNode(this.tree, targetId)
    const node = findNode(this.tree, id)
    if (!target || !node || id === targetId || targetId.startsWith(`${id}.`)) return false
    let pid, index
    if (where === 'inside') {
      pid = targetId
      index = target.children.length
    } else {
      pid = parentId(targetId)
      index = Number(targetId.split('.').pop()) + (where === 'after' ? 1 : 0)
    }
    if (!this.accepts(pid, node.tag ?? this.instanceOf(node)?.comp?.rootTag)) return false
    this.mutate(tree => moveNode(tree, id, pid, index))
    return true
  }

  tagOf(id) {
    if (id === '' || id == null) return null
    return findNode(this.tree, id)?.tag ?? null
  }

  accepts(parentNodeId, childTag) {
    if (childTag === undefined) return true // nodos de texto / comandos: libres
    const ptag = this.tagOf(parentNodeId)
    if (ptag === null) return this.isFragment ? canContain(null, childTag) : childTag === 'mjml'
    if (ptag === 'mjml') return ['mj-head', 'mj-body'].includes(childTag)
    return canContain(ptag, childTag)
  }

  /** Inserta un componente nuevo en el lugar más razonable según la selección */
  add(tag) {
    const node = COMPONENTS[tag].create()
    // texto y botones nacen traducibles
    if (COMPONENTS[tag].editable) {
      const key = this.uniqueKey(tag === 'mj-button' ? 'cta' : 'text')
      this.addMessage(key, tag === 'mj-button' ? 'Botón' : 'Nuevo texto')
      node.content = `$t('${key}')`
    }
    const placement = this.findPlacement(tag)
    if (placement) {
      this.mutate(tree => insertNode(tree, placement.pid, placement.index, node), null)
      return
    }
    // si no cabe directamente, se envuelve en sección > columna
    let wrapped = node
    if (canContain('mj-column', tag)) wrapped = { ...COMPONENTS['mj-column'].create(), children: [node] }
    if (canContain('mj-section', wrapped.tag)) wrapped = { ...COMPONENTS['mj-section'].create(), children: [wrapped] }
    const p = this.findPlacement(wrapped.tag)
    if (!p) return this.notify(`No hay dónde insertar ${tag}`, 'error')
    this.mutate(tree => {
      const id = insertNode(tree, p.pid, p.index, wrapped)
      let leaf = id
      while (findNode(tree, leaf).tag !== tag) leaf = `${leaf}.0`
      return leaf
    }, null)
  }

  findPlacement(tag) {
    const bodyId = this.bodyId()
    let cur = this.selectedId ?? null
    while (cur !== null && cur !== undefined) {
      const node = findNode(this.tree, cur)
      if (node?.type === 'element' && this.accepts(cur, tag)) return { pid: cur, index: node.children.length }
      const pid = parentId(cur)
      if (cur !== '' && this.accepts(pid, tag)) return { pid, index: Number(cur.split('.').pop()) + 1 }
      if (cur === '' || cur === bodyId) break
      cur = pid
    }
    if (bodyId !== null && this.accepts(bodyId, tag)) return { pid: bodyId, index: findNode(this.tree, bodyId).children.length }
    return null
  }

  /** id del contenedor de primer nivel: '' en fragmentos, el mj-body en documentos completos */
  bodyId() {
    if (this.isFragment) return ''
    const mjml = this.tree.children.findIndex(c => c.tag === 'mjml')
    if (mjml === -1) return ''
    const body = this.tree.children[mjml].children.findIndex(c => c.tag === 'mj-body')
    return body === -1 ? null : `${mjml}.${body}`
  }

  // ── Componentes reutilizables ─────────────────────────────
  /** Info de una instancia de componente ($import) o null */
  instanceOf(node) {
    const call = importCall(node)
    if (!call) return null
    const ref = call.path
    const comp = this.components.find(c => ref === c.importPath || ref === `${c.importPath}/${c.name}.mjml` || ref === `${c.importPath}.mjml`)
    return { ref, params: call.params, comp, name: comp?.name ?? ref.split('/').pop().replace(/\.mjml$/, '') }
  }

  /** Cambia (o quita, con valor vacío) un parámetro de una instancia */
  setParam(id, name, value) {
    const info = this.instanceOf(findNode(this.tree, id))
    if (!info) return
    const params = info.params.filter(([k]) => k !== name)
    const idx = info.params.findIndex(([k]) => k === name)
    if (value !== '' && value != null) params.splice(idx === -1 ? params.length : idx, 0, [name, value])
    this.mutate(tree => { findNode(tree, id).value = formatImportCall(info.ref, params) }, `param:${id}:${name}`)
  }

  // ── Declaración de parámetros (frontmatter del componente) ──
  #editFrontmatter(fn, tag) {
    const fm = YAML.parseDocument(this.split.frontmatter || '')
    if (fm.errors.length) return this.notify('El frontmatter tiene errores; corrígelo en la vista Código', 'error')
    if (!fm.contents) fm.contents = fm.createNode({})
    fn(fm)
    const text = fm.toString().trim()
    this.update({ mjml: joinFrontmatter(text === '{}' ? '' : text, this.split.body) }, tag)
  }

  addParamDecl(name) {
    name = name.trim()
    if (!/^[A-Za-z_][\w-]*$/.test(name)) return this.notify('Nombre de parámetro no válido (letras, números, _ y -)', 'error')
    if (this.componentParams[name]) return this.notify(`El parámetro ${name} ya existe`, 'error')
    this.#editFrontmatter(fm => fm.setIn(['params', name], fm.createNode({ type: 'text', label: name, default: '' })))
  }

  setParamDecl(name, field, value) {
    this.#editFrontmatter(fm => {
      const cur = fm.getIn(['params', name], true)
      // forma corta (`nombre: valor`) → forma completa
      if (!YAML.isMap(cur)) fm.setIn(['params', name], fm.createNode({ type: 'text', label: name, default: cur?.value ?? cur ?? '' }))
      if (value === '' || value == null || (Array.isArray(value) && !value.length)) {
        if (field !== 'default' && fm.hasIn(['params', name, field])) fm.deleteIn(['params', name, field])
        else if (field === 'default') fm.setIn(['params', name, field], '')
      } else {
        fm.setIn(['params', name, field], Array.isArray(value) ? fm.createNode(value, { flow: true }) : value)
      }
    }, `pdecl:${name}:${field}`)
  }

  removeParamDecl(name) {
    this.#editFrontmatter(fm => {
      fm.deleteIn(['params', name])
      if (!fm.get('params')?.items?.length) fm.delete('params')
    })
  }

  insertComponent(comp) {
    const node = { type: 'text', value: `$import(${comp.importPath})` }
    const p = this.findPlacement(comp.rootTag)
    if (!p) return this.notify(`No hay dónde insertar ${comp.name}`, 'error')
    this.mutate(tree => insertNode(tree, p.pid, p.index, node))
  }

  async openComponent(compId) {
    if (this.dirty) await this.save()
    await this.open(compId, 'component')
  }

  async back() {
    if (!this.returnTo) return
    if (this.dirty) await this.save()
    await this.open(this.returnTo)
  }

  /** Claves $t usadas dentro de un subárbol */
  keysIn(node) {
    const keys = new Set()
    walk(node, (n) => {
      const text = [n.content, n.value, ...(n.attrs || []).map(a => a[1])].filter(Boolean).join(' ')
      for (const m of text.matchAll(/\$t\(\s*['"]([^'"]+)['"]\s*\)/g)) keys.add(m[1])
    })
    return [...keys]
  }

  /** Convierte el bloque seleccionado en un componente reutilizable y lo sustituye por su instancia */
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
      // los textos pasan al componente (salvo que la plantilla los siga usando)
      const stillUsed = new Set(this.keysIn(this.tree))
      const moved = keys.filter(k => !stillUsed.has(k))
      if (moved.length) this.#editYaml(doc => { for (const l of this.langs) for (const k of moved) doc.deleteIn(['messages', l, k]) })
      this.notify(`Componente «${comp.id}» creado`)
    } catch (e) {
      this.notify(e.message, 'error')
    }
  }

  /** Sustituye una instancia por una copia editable de su contenido (y copia sus textos a la plantilla) */
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
    if (doc.errors.length) return this.notify('El YAML tiene errores; corrígelo en la vista Código', 'error')
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
    if (this.langs.some(l => this.i18n.messages?.[l]?.[newKey] != null)) return this.notify(`La clave ${newKey} ya existe`, 'error')
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

  removeLang(lang) {
    if (!confirm(`¿Eliminar el idioma "${lang}" y todas sus traducciones?`)) return
    this.#editYaml(doc => {
      doc.deleteIn(['messages', lang])
      if (doc.hasIn(['subject', lang])) doc.deleteIn(['subject', lang])
    })
    if (this.lang === lang) this.lang = this.langs.find(l => l !== lang)
  }

  /** Clave $t si el contenido del nodo es exactamente $t('clave') */
  keyOf(node) {
    return node?.content?.trim().match(EXACT_T)?.[1] ?? null
  }

  makeTranslatable(id) {
    const node = findNode(this.tree, id)
    const key = this.uniqueKey(node.tag === 'mj-button' ? 'cta' : 'text')
    this.addMessage(key, node.content.trim())
    this.setContent(id, `$t('${key}')`, null)
  }

  inlineTranslation(id) {
    const node = findNode(this.tree, id)
    const key = this.keyOf(node)
    this.setContent(id, String(this.messages[key] ?? '').trim(), null)
  }

  setLayout(layout) {
    if (!this.isFragment && layout) {
      return this.notify('Para usar un layout, la plantilla debe ser un fragmento (sin <mjml>). Edítala en la vista Código.', 'error')
    }
    const fm = YAML.parseDocument(this.split.frontmatter || '')
    if (!fm.contents) fm.contents = fm.createNode({})
    if (layout) fm.set('layout', layout)
    else fm.delete('layout')
    const fmText = fm.toString().trim()
    if (!layout && !this.isFragment) return
    if (!layout) return this.notify('Quitar el layout dejaría la plantilla sin <mjml>; hazlo desde la vista Código.', 'error')
    this.update({ mjml: joinFrontmatter(fmText === '{}' ? '' : fmText, this.split.body) })
  }
}

function setScalar(doc, path, value) {
  const node = doc.getIn(path, true)
  if (node && YAML.isScalar(node)) {
    // conserva el estilo (p.ej. bloques `>`) salvo que el texto lo impida
    node.value = value
    if ((node.type === 'BLOCK_FOLDED' || node.type === 'BLOCK_LITERAL') && !value) node.type = 'PLAIN'
  } else {
    doc.setIn(path, value)
  }
}

export const store = new EditorStore()
export { getAttr }
