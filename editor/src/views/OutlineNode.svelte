<script>
  import Self from './OutlineNode.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { describe, NON_VISUAL } from '@shared/components.js'

  let { node, depth = 0, drag } = $props()

  let collapsed = $state(false)
  let dropWhere = $state(null)

  const isEl = $derived(node.type === 'element')
  const instance = $derived(store.instanceOf(node))
  const slot = $derived(node.type === 'text' && node.value.trim() === '$content')
  const def = $derived(isEl ? describe(node.tag) : null)
  const hasKids = $derived(isEl && node.children.length > 0)

  const summary = $derived.by(() => {
    if (instance) return instance.comp ? `${instance.comp.usedBy.length} use(s)` : instance.ref
    if (node.type === 'text') return node.value
    if (node.type === 'comment') return `<!-- ${node.value} -->`
    if (node.content != null) {
      const key = store.keyOf(node)
      const text = key ? store.messages[key] ?? `⚠ ${key}` : node.content
      return String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    }
    if (node.tag === 'mj-image') return node.attrs.find(([k]) => k === 'src')?.[1]?.split('/').pop() || ''
    return ''
  })

  function onDragOver(e) {
    if (!drag.id || drag.id === node.id || node.id.startsWith(`${drag.id}.`)) return
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    const canInside = isEl && node.content == null && store.accepts(node.id, drag.tag)
    let where = y < 0.3 ? 'before' : y > 0.7 ? 'after' : canInside ? 'inside' : y < 0.5 ? 'before' : 'after'
    if (where !== 'inside' && !store.accepts(node.id.split('.').slice(0, -1).join('.'), drag.tag)) {
      where = canInside ? 'inside' : null
    }
    if (!where) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dropWhere = where
  }

  function onDrop(e) {
    e.preventDefault()
    const where = dropWhere
    dropWhere = null
    if (where && drag.id) store.drop(drag.id, node.id, where)
    drag.id = null
  }
</script>

{#if !(isEl && NON_VISUAL.has(node.tag) && node.tag !== 'mjml')}
  <div
    class="row drop-{dropWhere}"
    class:selected={store.selectedId === node.id}
    class:muted={!isEl}
    style="padding-left: {8 + depth * 14}px"
    role="treeitem"
    aria-selected={store.selectedId === node.id}
    tabindex="-1"
    draggable={node.tag !== 'mjml' && node.tag !== 'mj-body'}
    ondblclick={() => instance?.comp && store.openComponent(instance.comp.id)}
    ondragstart={(e) => { drag.id = node.id; drag.tag = node.tag ?? instance?.comp?.rootTag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id) }}
    ondragend={() => { drag.id = null; dropWhere = null }}
    ondragover={onDragOver}
    ondragleave={() => (dropWhere = null)}
    ondrop={onDrop}
    onclick={() => (store.selectedId = node.id)}
    onkeydown={() => {}}
  >
    <button class="twisty ghost" class:hidden={!hasKids} onclick={(e) => { e.stopPropagation(); collapsed = !collapsed }} tabindex="-1">
      {collapsed ? '▸' : '▾'}
    </button>
    <span class="icon" class:comp={instance} class:slot>{isEl ? def.icon : instance ? '◆' : slot ? '⧉' : node.type === 'comment' ? '#' : '$'}</span>
    <span class="label" class:comp={instance} class:slot>{isEl ? def.label : instance ? instance.name : slot ? 'Template content' : node.type === 'comment' ? 'Comment' : 'Code'}</span>
    <span class="summary" title={summary}>{summary}</span>
    {#if node.tag !== 'mjml' && node.tag !== 'mj-body'}
      <span class="actions">
        <button class="ghost" title="Move up" onclick={(e) => { e.stopPropagation(); store.move(node.id, -1) }}>↑</button>
        <button class="ghost" title="Move down" onclick={(e) => { e.stopPropagation(); store.move(node.id, 1) }}>↓</button>
        <button class="ghost" title="Duplicate" onclick={(e) => { e.stopPropagation(); store.duplicate(node.id) }}>⧉</button>
        <button class="ghost danger" title="Delete" onclick={(e) => { e.stopPropagation(); store.selectedId = node.id; store.removeSelected() }}>✕</button>
      </span>
    {/if}
  </div>
  {#if hasKids && !collapsed}
    {#each node.children as child (child.id)}
      <Self node={child} depth={depth + 1} {drag} />
    {/each}
  {/if}
{/if}

<style>
  .row {
    display: flex; align-items: center; gap: 4px; height: 26px; padding-right: 4px; cursor: pointer;
    border-top: 2px solid transparent; border-bottom: 2px solid transparent; user-select: none;
  }
  .row:hover { background: #f4f4f5; }
  .row.selected { background: var(--accent-soft); }
  .row.drop-before { border-top-color: var(--accent); }
  .row.drop-after { border-bottom-color: var(--accent); }
  .row.drop-inside { background: #e0e7ff; outline: 1px dashed var(--accent); }
  .twisty { width: 16px; padding: 0; font-size: 10px; color: var(--muted); }
  .twisty.hidden { visibility: hidden; }
  .icon { width: 18px; text-align: center; font-size: 12px; color: var(--muted); flex: none; }
  .label { font-weight: 500; flex: none; }
  .muted .label { color: var(--muted); font-weight: 400; }
  .muted .label.comp, .label.comp { color: #6d28d9; font-weight: 500; }
  .icon.comp { color: #7c3aed; font-size: 10px; }
  .label.slot, .icon.slot { color: #b45309; font-weight: 500; }
  .summary { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; font-size: 12px; }
  .actions { display: none; flex: none; }
  .row:hover .actions { display: flex; }
  .actions button { padding: 0 4px; font-size: 11px; height: 20px; }
</style>
