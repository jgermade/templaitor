<script>
  import OutlineNode from './OutlineNode.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { PALETTE, describe } from '@shared/components.js'

  const drag = $state({ id: null, tag: null })
</script>

<aside>
  <div class="panel-title">Bloques</div>
  <div class="palette">
    {#each PALETTE as tag}
      {@const d = describe(tag)}
      <button onclick={() => store.add(tag)} title="Añadir {d.label} ({tag})">
        <span class="ic">{d.icon}</span>{d.label}
      </button>
    {/each}
  </div>

  <div class="panel-title">
    Estructura
    <span class="grow"></span>
    {#if store.frontmatter.layout}<span class="muted mono" title="Layout">⧉ {store.frontmatter.layout}</span>{/if}
  </div>
  <div class="tree" role="tree">
    {#each store.tree.children as node (node.id)}
      <OutlineNode {node} {drag} />
    {:else}
      <div class="empty">Plantilla vacía. Añade una sección desde «Bloques».</div>
    {/each}
  </div>
</aside>

<style>
  aside { display: flex; flex-direction: column; min-height: 0; background: var(--panel); border-right: 1px solid var(--border); }
  .palette { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; padding: 0 10px 8px; }
  .palette button { display: flex; align-items: center; gap: 6px; text-align: left; font-size: 12px; padding: 4px 8px; }
  .palette .ic { width: 16px; text-align: center; color: var(--muted); }
  .tree { flex: 1; overflow: auto; padding-bottom: 24px; }
</style>
