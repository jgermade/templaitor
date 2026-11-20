<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  const canExtract = $derived(store.selected?.type === 'element' && !['mjml', 'mj-body'].includes(store.selected.tag) && !store.isComponent)

  async function extract() {
    const name = prompt('Nombre del nuevo componente:', store.selected.tag === 'mj-section' ? 'bloque' : store.selected.tag.replace('mj-', ''))
    if (name) await store.extractComponent(store.selectedId, name.trim())
  }

  async function create() {
    const id = prompt('Nombre del componente (p.ej. header, legal-notice):')
    if (!id) return
    try {
      await api.createComponent({ id: id.trim() })
      await store.refreshTemplates()
      store.notify(`Componente «${id}» creado`)
    } catch (e) { store.notify(e.message, 'error') }
  }
</script>

<ul>
  {#each store.components.filter(c => !(store.isComponent && c.id === store.doc.id)) as c (c.id)}
    <li>
      <button class="ins" onclick={() => store.insertComponent(c)} title="Insertar {c.name} ($import({c.importPath}))">
        <span class="diamond">◆</span>
        <span class="name">{c.name}</span>
        <span class="uses" title={c.usedBy.map(u => u.id).join('\n')}>{c.usedBy.length} uso(s)</span>
      </button>
      <button class="ghost edit" title="Editar componente" onclick={() => store.openComponent(c.id)}>✎</button>
    </li>
  {:else}
    <li class="empty">Aún no hay componentes.</li>
  {/each}
</ul>
<div class="actions">
  {#if canExtract}
    <button onclick={extract} title="Mueve el bloque seleccionado (y sus textos) a un componente reutilizable">◆ Convertir selección en componente</button>
  {/if}
  <button class="ghost" onclick={create}>＋ Nuevo componente</button>
</div>

<style>
  ul { list-style: none; margin: 0; padding: 0 10px; }
  li { display: flex; align-items: center; gap: 2px; }
  .ins { flex: 1; display: flex; align-items: center; gap: 8px; border: 1px solid transparent; background: none; text-align: left; padding: 5px 6px; }
  .ins:hover { background: #fff; border-color: var(--border); }
  .diamond { color: #7c3aed; font-size: 11px; }
  .name { font-weight: 500; }
  .uses { margin-left: auto; font-size: 11px; color: var(--muted); }
  .edit { padding: 2px 8px; }
  .empty { color: var(--muted); font-size: 12px; padding: 4px 6px; }
  .actions { display: grid; gap: 4px; padding: 8px 14px 0; }
</style>
