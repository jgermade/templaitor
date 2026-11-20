<script>
  import OutlineNode from './OutlineNode.svelte'
  import { store } from '../stores/editor.svelte.js'

  const drag = $state({ id: null, tag: null })
</script>

<div class="tree" role="tree">
  {#each store.tree.children as node (node.id)}
    <OutlineNode {node} {drag} />
  {:else}
    <div class="empty">Empty. Add a section from "Blocks".</div>
  {/each}
</div>

<style>
  .tree { padding: 0 4px; }
</style>
