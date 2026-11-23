<script>
  import Icon from '../components/Icon.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'

  const canExtract = $derived(store.selected?.type === 'element' && !['mjml', 'mj-body'].includes(store.selected.tag) && !store.isComponent)

  async function extract() {
    const name = await promptDialog({
      title: 'Turn into a component',
      message: 'The selected block and its texts will move to a reusable component.',
      label: 'Component name', value: store.selected.tag === 'mj-section' ? 'block' : store.selected.tag.replace('mj-', ''),
      okLabel: 'Create component', pattern: '[\\w.\\-]+', hint: 'Letters, digits, hyphens and dots.',
    })
    if (name) await store.extractComponent(store.selectedId, name.trim())
  }

  async function create() {
    const id = await promptDialog({ title: 'New component', label: 'Name', placeholder: 'header, legal-notice…', okLabel: 'Create', pattern: '[\\w.\\-]+' })
    if (!id) return
    try {
      await api.createComponent({ id: id.trim() })
      await store.refreshTemplates()
      store.notify(`Component "${id}" created`)
    } catch (e) { store.notify(e.message, 'error') }
  }
</script>

<ul>
  {#each store.components.filter(c => !(store.isComponent && c.id === store.doc.id)) as c (c.id)}
    <li>
      <button class="ins" onclick={() => store.insertComponent(c)} title="Insert {c.name} ($import({c.importPath}))">
        <span class="diamond"><Icon name="component" size={10} /></span>
        <span class="name">{c.name}</span>
        <span class="uses" title={c.usedBy.map(u => u.id).join('\n')}>{c.usedBy.length} use(s)</span>
      </button>
      <button class="ghost edit" title="Edit component" aria-label="Edit component {c.name}" onclick={() => store.openComponent(c.id)}><Icon name="pencil" size={13} /></button>
    </li>
  {:else}
    <li class="empty">No components yet.</li>
  {/each}
</ul>
<div class="actions">
  {#if canExtract}
    <button onclick={extract} title="Moves the selected block (and its texts) to a reusable component"><Icon name="component" size={10} /> Turn selection into a component</button>
  {/if}
  <button class="ghost" onclick={create}><Icon name="plus" size={13} /> New component</button>
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
