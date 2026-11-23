<script>
  // Right aside when nothing is selected (Design view): the blocks and components that can be added.
  // Both are dragged to the canvas or the structure; a block can also be added with a click (after the
  // selection, or at the end), a component with Enter (keyboard alternative).
  import Icon from '../components/Icon.svelte'
  import ComponentsPanel from './ComponentsPanel.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { PALETTE, describe } from '@shared/components.js'

  function dragStart(e, tag) {
    store.drag.item = store.blockItem(tag)
    store.drag.id = null
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', tag)
  }
  const dragEnd = () => (store.drag.item = null)
</script>

<aside aria-label="Add blocks and components">
  <div class="head">
    <h2>Add</h2>
    <p>Drag a block or a component to the canvas or the structure. Select something to edit it here.</p>
  </div>

  <section aria-labelledby="lib-blocks">
    <h3 id="lib-blocks">Blocks</h3>
    <div class="palette">
      {#each PALETTE as tag}
        {@const d = describe(tag)}
        <button draggable="true" ondragstart={(e) => dragStart(e, tag)} ondragend={dragEnd} onclick={() => store.add(tag)}
          title="Drag to the canvas, or click to add {d.label} ({tag}) at the end">
          <span class="ic"><Icon name={d.icon} size={16} /></span>{d.label}
        </button>
      {/each}
      {#if store.isPdf}
        <button onclick={() => store.addPageBreak()} title="Forces a new page in the PDF"><span class="ic"><Icon name="page-break" size={16} /></span>Page break</button>
      {/if}
    </div>
  </section>

  <section aria-labelledby="lib-components">
    <h3 id="lib-components">Components <span class="count">{store.components.length}</span></h3>
    <ComponentsPanel />
  </section>
</aside>

<style>
  aside { background: var(--panel); border-left: 1px solid var(--border); overflow: auto; min-height: 0; padding-bottom: 24px; }
  .head { padding: 12px 14px 4px; }
  h2 { margin: 0 0 2px; font-size: 14px; }
  .head p { margin: 0; font-size: 12px; color: #52525b; }
  section { border-top: 1px solid var(--border); margin-top: 10px; padding-top: 8px; }
  h3 { margin: 0 0 8px; padding: 0 14px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #52525b; display: flex; align-items: center; gap: 6px; }
  .count { font-size: 11px; letter-spacing: 0; padding: 0 6px; border-radius: 999px; background: #f4f4f5; color: #52525b; }
  .palette { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding: 0 14px; }
  .palette button { display: flex; align-items: center; gap: 8px; text-align: left; font-size: 12.5px; padding: 7px 9px; cursor: grab; }
  .palette button:active { cursor: grabbing; }
  .ic { display: inline-grid; color: #52525b; }
</style>
