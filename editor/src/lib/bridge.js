// Script que se inyecta dentro del iframe del lienzo.
// Debe ser autocontenido: se serializa con Function.prototype.toString().
//
// iframe → editor:  ready · select · hover · editstart · edit · editend · key
// editor → iframe:  update · select · insert

/* eslint-disable no-undef */
export function bridgeMain() {
  const STYLE = `
    .tpl-design .tpl-node { cursor: default; }
    .tpl-design .tpl-hover { outline: 1px dashed #818cf8 !important; outline-offset: -1px; }
    .tpl-design .tpl-selected { outline: 2px solid #4f46e5 !important; outline-offset: -2px; }
    .tpl-design [data-tpl-edit] { cursor: text; border-radius: 2px; min-height: 1em; }
    .tpl-design [data-tpl-edit][contenteditable="true"] { outline: 2px solid #f59e0b; outline-offset: 2px; background: rgba(245,158,11,.06); }
    .tpl-design [data-tpl-edit]:empty::before { content: 'Escribe aquí…'; opacity: .45; font-style: italic; }
    .tpl-design [data-tpl-missing]:empty::before { content: '⚠ Sin traducción'; color: #dc2626; opacity: 1; }
    .tpl-chip { display: inline-block; padding: 0 .45em; margin: 0 1px; border-radius: 999px; border: 1px solid #c7d2fe;
      background: #eef2ff; color: #4338ca !important; font: 600 .82em/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap; vertical-align: baseline; user-select: all; text-decoration: none; text-transform: none; }
    .tpl-chip--stmt, .tpl-chip--comment { background: #fef3c7; border-color: #fcd34d; color: #92400e !important; }
    .tpl-chip--link { background: #dcfce7; border-color: #86efac; color: #166534 !important; }
    .tpl-chip--t { background: #e0f2fe; border-color: #7dd3fc; color: #075985 !important; }
    .tpl-chip--cmd { background: #f3f4f6; border-color: #d1d5db; color: #374151 !important; }
    .tpl-chip--var::before { content: '{ '; opacity: .5 } .tpl-chip--var::after { content: ' }'; opacity: .5 }
    .tpl-chip--link::before { content: '🔗 '; } .tpl-chip--t::before { content: '🌐 '; }
    #tpl-badge { position: absolute; z-index: 99999; pointer-events: none; background: #4f46e5; color: #fff;
      font: 600 10px/16px system-ui, sans-serif; padding: 0 6px; border-radius: 3px 3px 0 0; transform: translateY(-100%); display: none; }
  `

  let mode = 'design'
  let selectedId = null
  let selectedLabel = ''
  let editing = null
  let savedRange = null
  let pending = null
  let editTimer = null

  const post = (msg) => parent.postMessage({ __tpl: true, ...msg }, '*')
  const idOf = (el) => {
    const m = (el?.getAttribute?.('class') || '').match(/(?:^|\s)tpl-node--([\d_]+)(?:\s|$)/)
    return m ? m[1].replace(/_/g, '.') : null
  }
  const nodeEl = (target) => target?.closest?.('.tpl-node')
  const elOf = (id) => (id == null ? null : document.querySelector(`.tpl-node--${String(id).replace(/\./g, '_')}`))

  function ensureChrome() {
    if (!document.getElementById('tpl-bridge-style')) {
      const s = document.createElement('style')
      s.id = 'tpl-bridge-style'
      s.textContent = STYLE
      document.head.appendChild(s)
    }
    if (!document.getElementById('tpl-badge')) {
      const b = document.createElement('div')
      b.id = 'tpl-badge'
      document.body.appendChild(b)
    }
    document.documentElement.classList.toggle('tpl-design', mode === 'design')
  }

  function applySelection(scroll) {
    document.querySelectorAll('.tpl-selected').forEach(e => e.classList.remove('tpl-selected'))
    const badge = document.getElementById('tpl-badge')
    const el = mode === 'design' ? elOf(selectedId) : null
    if (!el) { if (badge) badge.style.display = 'none'; return }
    el.classList.add('tpl-selected')
    if (scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    positionBadge()
  }

  function positionBadge() {
    const badge = document.getElementById('tpl-badge')
    const el = elOf(selectedId)
    if (!badge || !el || !selectedLabel) { if (badge) badge.style.display = 'none'; return }
    const r = el.getBoundingClientRect()
    badge.textContent = selectedLabel
    badge.style.display = 'block'
    badge.style.left = `${r.left + scrollX}px`
    badge.style.top = `${r.top + scrollY}px`
  }

  // ── Serialización de la región editable → código fuente ─────
  const INLINE = /^(B|STRONG|I|EM|U|S|SMALL|SUP|SUB|CODE|SPAN|A)$/
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

  function toSource(root) {
    let out = ''
    root.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += esc(n.nodeValue.replace(/ /g, ' ')); return }
      if (n.nodeType !== 1) return
      if (n.dataset.tplSrc !== undefined) { out += n.dataset.tplSrc; return }
      const tag = n.tagName
      if (tag === 'BR') { out += '<br>'; return }
      if (INLINE.test(tag)) {
        const t = tag.toLowerCase()
        let attrs = ''
        if (t === 'a' && n.getAttribute('href')) attrs += ` href="${escAttr(n.getAttribute('href'))}"`
        if (n.getAttribute('style')) attrs += ` style="${escAttr(n.getAttribute('style'))}"`
        const inner = toSource(n)
        out += t === 'span' && !attrs ? inner : `<${t}${attrs}>${inner}</${t}>`
        return
      }
      if (tag === 'DIV' || tag === 'P') {
        const inner = toSource(n)
        out += (out && !out.endsWith('<br>') ? '<br>' : '') + inner
        return
      }
      out += toSource(n)
    })
    return out
  }

  // ── Edición ─────────────────────────────────────────────────
  function startEdit(region) {
    if (editing?.region === region) return
    if (editing) stopEdit()
    region.contentEditable = 'true'
    editing = { region, target: region.dataset.tplEdit }
    region.focus()
    post({ type: 'editstart', target: editing.target })
  }

  function flush() {
    clearTimeout(editTimer)
    if (!editing) return
    post({ type: 'edit', target: editing.target, value: toSource(editing.region).trim() })
  }

  function stopEdit() {
    if (!editing) return
    flush()
    editing.region.contentEditable = 'false'
    editing = null
    savedRange = null
    post({ type: 'editend' })
    if (pending) { const p = pending; pending = null; applyUpdate(p) }
  }

  // ── Actualizaciones de contenido ────────────────────────────
  function applyUpdate({ html }) {
    if (editing) { pending = { html }; return }
    const y = scrollY
    const doc = new DOMParser().parseFromString(html, 'text/html')
    document.head.innerHTML = doc.head.innerHTML
    for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name)
    for (const a of doc.body.attributes) document.body.setAttribute(a.name, a.value)
    document.body.innerHTML = doc.body.innerHTML
    ensureChrome()
    applySelection(false)
    scrollTo(0, y)
  }

  addEventListener('message', (e) => {
    const msg = e.data
    if (!msg?.__tpl) return
    if (msg.type === 'update') { mode = msg.mode; applyUpdate(msg) }
    if (msg.type === 'select') {
      selectedId = msg.id
      selectedLabel = msg.label || ''
      applySelection(msg.scroll)
    }
    if (msg.type === 'insert' && editing) {
      editing.region.focus()
      if (savedRange) {
        const sel = getSelection()
        sel.removeAllRanges()
        sel.addRange(savedRange)
      }
      document.execCommand('insertHTML', false, msg.html + '​')
      // elimina el espacio de anchura cero auxiliar
      editing.region.innerHTML = editing.region.innerHTML.replace(/​/g, '')
      flush()
    }
  })

  document.addEventListener('mouseover', (e) => {
    if (mode !== 'design') return
    const el = nodeEl(e.target)
    document.querySelectorAll('.tpl-hover').forEach(x => x !== el && x.classList.remove('tpl-hover'))
    if (el) el.classList.add('tpl-hover')
  })
  document.addEventListener('mouseleave', () => document.querySelectorAll('.tpl-hover').forEach(x => x.classList.remove('tpl-hover')))

  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a')
    if (link) e.preventDefault()
    if (mode !== 'design') return
    const region = e.target.closest?.('[data-tpl-edit]')
    if (editing && editing.region !== region) stopEdit()
    const el = nodeEl(e.target)
    const id = idOf(el)
    if (id !== selectedId) post({ type: 'select', id })
    if (region) startEdit(region)
  }, true)

  document.addEventListener('dblclick', (e) => {
    if (mode !== 'design') return
    const el = nodeEl(e.target)
    const region = el?.querySelector('[data-tpl-edit]')
    if (region && !editing) startEdit(region)
  })

  document.addEventListener('input', (e) => {
    if (!editing || !editing.region.contains(e.target)) return
    clearTimeout(editTimer)
    editTimer = setTimeout(flush, 150)
  })

  document.addEventListener('focusout', (e) => {
    if (editing && e.target === editing.region) setTimeout(() => { if (editing && document.activeElement !== editing.region) stopEdit() }, 0)
  })

  document.addEventListener('selectionchange', () => {
    if (!editing) return
    const sel = getSelection()
    if (sel.rangeCount && editing.region.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange()
  })

  document.addEventListener('paste', (e) => {
    if (!editing) return
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  })

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); post({ type: 'key', key: 'save' }); return }
    if (editing) {
      if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak') }
      if (e.key === 'Escape') { e.preventDefault(); stopEdit() }
      return
    }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); post({ type: 'key', key: e.shiftKey ? 'redo' : 'undo' }); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); post({ type: 'key', key: 'redo' }); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); post({ type: 'key', key: 'delete' }) }
    if (e.key === 'Escape') post({ type: 'select', id: null })
  })

  addEventListener('resize', positionBadge)
  ensureChrome()
  post({ type: 'ready' })
}

export const bridgeScript = `<script>(${bridgeMain.toString()})()<\/script>`
