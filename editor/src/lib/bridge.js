// Script injected into the canvas iframe.
// It must be self-contained: it is serialized with Function.prototype.toString().
//
// iframe → editor:  ready · select · hover · editstart · edit · editend · key
// editor → iframe:  update · select · insert

/* eslint-disable no-undef */
export function bridgeMain() {
  const STYLE = `
    .tpl-design .tpl-node { cursor: default; }
    .tpl-design .tpl-hover { outline: 1px dashed #818cf8 !important; outline-offset: -1px; }
    .tpl-design .tpl-selected { outline: 2px solid #4f46e5 !important; outline-offset: -2px; }
    .tpl-design .tpl-comp { cursor: pointer; }
    .tpl-design .tpl-comp.tpl-hover { outline: 1px dashed #a78bfa !important; }
    .tpl-design .tpl-comp.tpl-selected { outline: 2px solid #7c3aed !important; }
    .tpl-design [data-tpl-edit] { cursor: text; border-radius: 2px; min-height: 1em; }
    .tpl-design [data-tpl-edit][contenteditable="true"] { outline: 2px solid #f59e0b; outline-offset: 2px; background: rgba(245,158,11,.06); }
    .tpl-design [data-tpl-edit]:empty::before { content: 'Type here…'; opacity: .45; font-style: italic; }
    .tpl-design [data-tpl-missing]:empty::before { content: 'Missing translation'; color: #dc2626; opacity: 1; padding-left: 1.3em;
      background: no-repeat left center / 1em 1em url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23dc2626' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'/%3E%3Cpath d='M12 9v4M12 17h.01'/%3E%3C/svg%3E"); }
    .tpl-chip { display: inline-block; padding: 0 .45em; margin: 0 1px; border-radius: 999px; border: 1px solid #c7d2fe;
      background: #eef2ff; color: #4338ca !important; font: 600 .82em/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap; vertical-align: baseline; user-select: all; text-decoration: none; text-transform: none; }
    .tpl-chip--stmt, .tpl-chip--comment { background: #fef3c7; border-color: #fcd34d; color: #92400e !important; }
    .tpl-chip--link { background: #dcfce7; border-color: #86efac; color: #166534 !important; }
    .tpl-chip--t { background: #e0f2fe; border-color: #7dd3fc; color: #075985 !important; }
    .tpl-chip--cmd { background: #f3f4f6; border-color: #d1d5db; color: #374151 !important; }
    .tpl-chip--param { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9 !important; }
    .tpl-chip--param::before { content: ''; display: inline-block; width: .95em; height: .95em; margin-right: .3em; vertical-align: -.12em; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cpath d='M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cpath d='M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1'/%3E%3C/svg%3E") center / contain no-repeat; opacity: .7; }
    .tpl-chip--param { font-family: inherit; font-weight: 600; font-size: .92em; }
    .tpl-chip--var::before { content: '{ '; opacity: .5 } .tpl-chip--var::after { content: ' }'; opacity: .5 }
    .tpl-chip--link::before { content: ''; display: inline-block; width: .95em; height: .95em; margin-right: .3em; vertical-align: -.12em; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'/%3E%3C/svg%3E") center / contain no-repeat; }
    .tpl-chip--t::before { content: ''; display: inline-block; width: .95em; height: .95em; margin-right: .3em; vertical-align: -.12em; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z'/%3E%3C/svg%3E") center / contain no-repeat; }
    .tpl-page-break { position: relative; height: 0; border-top: 2px dashed #a1a1aa; margin: 22px 0; }
    .tpl-page-break::after { content: 'Page break'; position: absolute; left: 50%; top: -9px; transform: translateX(-50%);
      background: #fff; color: #71717a; font: 600 10px/16px system-ui, sans-serif; padding: 0 8px; border-radius: 8px; border: 1px solid #d4d4d8; }
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
  const sel = (id) => `.tpl-node--${String(id).replace(/\./g, '_')}`
  const elOf = (id) => (id == null ? null : document.querySelector(sel(id)))
  const elsOf = (id) => (id == null ? [] : [...document.querySelectorAll(sel(id))])

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
    const els = mode === 'design' ? elsOf(selectedId) : []
    const el = els[0]
    if (!el) { if (badge) badge.style.display = 'none'; return }
    els.forEach(e => e.classList.add('tpl-selected'))
    if (scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    positionBadge()
  }

  function positionBadge() {
    const badge = document.getElementById('tpl-badge')
    const el = elOf(selectedId)
    if (!badge || !el || !selectedLabel) { if (badge) badge.style.display = 'none'; return }
    const r = el.getBoundingClientRect()
    badge.textContent = selectedLabel
    badge.style.background = el.classList.contains('tpl-comp') ? '#7c3aed' : '#4f46e5'
    badge.style.display = 'block'
    badge.style.left = `${r.left + scrollX}px`
    badge.style.top = `${r.top + scrollY}px`
    // if it does not fit above (block at the very top), draw it inside
    const inside = r.top < 18
    badge.style.transform = inside ? 'none' : 'translateY(-100%)'
    badge.style.borderRadius = inside ? '0 0 3px 0' : '3px 3px 0 0'
  }

  // ── Editable region serialization → source code ─────────
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

  // ── Editing ─────────────────────────────────────────────────
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

  // ── Content updates ───────────────────────────────────────
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
      // removes the helper zero-width space
      editing.region.innerHTML = editing.region.innerHTML.replace(/​/g, '')
      flush()
    }
  })

  document.addEventListener('mouseover', (e) => {
    if (mode !== 'design') return
    const el = nodeEl(e.target)
    const group = el ? elsOf(idOf(el)) : []
    document.querySelectorAll('.tpl-hover').forEach(x => !group.includes(x) && x.classList.remove('tpl-hover'))
    group.forEach(x => x.classList.add('tpl-hover'))
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
    if (el?.classList.contains('tpl-comp')) { post({ type: 'opencomp', id: idOf(el) }); return }
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
