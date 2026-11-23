<script>
  import { store } from '../stores/editor.svelte.js'
  import { bridgeScript } from '../lib/bridge.js'
  import { describe } from '@shared/components.js'
  import { findNode } from '@shared/mjml-tree.js'
  import { chipify } from '@engine/design.js'

  let { mode = 'design' } = $props()

  let iframe = $state()
  let ready = $state(false)
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body>${bridgeScript}</body></html>`

  const post = (msg) => iframe?.contentWindow?.postMessage({ __tpl: true, ...msg }, '*')

  // content
  $effect(() => {
    const html = store.preview.html
    if (ready && html) post({ type: 'update', html, mode })
  })

  // selection
  $effect(() => {
    const id = store.selectedId
    const node = id != null ? findNode(store.tree, id) : null
    const inst = store.instanceOf(node)
    const label = inst ? `Component ${inst.name} · double-click to edit` : node?.tag ? `${describe(node.tag).label} · ${node.tag}` : ''
    if (ready) post({ type: 'select', id, label, scroll: store.selectSource !== 'canvas' })
  })

  let dragged = null
  // a block or component dragged from the library: the canvas gets the valid drop targets (the iframe
  // draws the line)
  $effect(() => {
    const item = store.drag.item
    if (!ready) return
    if (item && mode === 'design') {
      dragged = item // dragend (in the library) may arrive before the iframe's drop message
      post({ type: 'dragtargets', targets: store.dropTargets(item), label: item.label })
    } else post({ type: 'dragend' })
  })

  // variable insertion from the inspector
  $effect(() => {
    const req = store.insertRequest
    if (ready && req) post({ type: 'insert', html: chipify(req.src) })
  })

  function onMessage(e) {
    if (e.source !== iframe?.contentWindow || !e.data?.__tpl) return
    const msg = e.data
    switch (msg.type) {
      case 'ready':
        ready = true
        if (store.preview.html) post({ type: 'update', html: store.preview.html, mode })
        break
      case 'select':
        store.selectSource = 'canvas'
        store.selectedId = msg.id
        queueMicrotask(() => (store.selectSource = null))
        break
      case 'editstart':
        store.editing = msg.target
        break
      case 'editend':
        store.editing = null
        break
      case 'edit': {
        const [kind, ...rest] = msg.target.split(':')
        const ref = rest.join(':')
        if (kind === 't') store.setMessage(store.lang, ref, msg.value)
        else if (kind === 'c') store.setInner(ref, msg.value)
        break
      }
      case 'drop':
        if (dragged && store.dropItem(dragged, msg.id, msg.where)) {
          store.selectSource = 'canvas'
          queueMicrotask(() => (store.selectSource = null))
        }
        dragged = null
        store.drag.item = null
        break
      case 'opencomp': {
        const info = store.instanceOf(findNode(store.tree, msg.id))
        if (info?.comp) store.openComponent(info.comp.id)
        break
      }
      case 'key':
        if (msg.key === 'save') store.save()
        if (msg.key === 'undo') store.undo()
        if (msg.key === 'redo') store.redo()
        if (msg.key === 'delete') store.removeSelected()
        break
    }
  }
</script>

<svelte:window onmessage={onMessage} />

<div class="stage" class:mobile={store.device === 'mobile'}>
  <iframe bind:this={iframe} title="Canvas" {srcdoc} sandbox="allow-scripts"></iframe>
</div>

<style>
  .stage { height: 100%; display: flex; justify-content: center; overflow: hidden; background: #f4f4f5; }
  iframe { width: 100%; max-width: 100%; height: 100%; border: 0; background: #fff; transition: width .2s; }
  .mobile { padding: 16px 0; }
  .mobile iframe { width: 390px; border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
</style>
