<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import Choice from '../components/Choice.svelte'

  const FORMATS = [{ value: 'email', label: 'Email', icon: 'email', color: '#2563eb' }, { value: 'pdf', label: 'PDF document', icon: 'pdf', color: '#dc2626' }]

  let { open = $bindable(false) } = $props()
  let dialog = $state()
  let id = $state('')
  let layout = $state('')
  let format = $state('email')
  let error = $state('')

  $effect(() => {
    if (!dialog) return
    if (open && !dialog.open) { error = ''; format = 'email'; layout = store.layoutsFor('email')[0]?.id || ''; dialog.showModal() }
    if (!open && dialog.open) dialog.close()
  })

  async function submit(e) {
    e.preventDefault()
    try {
      const t = await api.create(id.trim(), layout || undefined, format)
      open = false
      id = ''
      await store.refreshTemplates()
      await store.open(t.id)
      store.notify(`Template ${t.id} created`)
    } catch (err) {
      error = err.message
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
  <form onsubmit={submit}>
    <h3>New template</h3>
    <label class="field">
      <span>Id (folder/name)</span>
      <input class="mono" placeholder="customers/welcome" bind:value={id} required pattern="[\w.\-]+(/[\w.\-]+)*" />
    </label>
    <div class="field">
      <span>Format</span>
      <Choice label="Format" bind:value={format} options={FORMATS} onchange={() => {
        // only the layouts of this format (`format:` in the layout's frontmatter)
        if (!store.layoutsFor(format).some(l => l.id === layout)) layout = store.layoutsFor(format)[0]?.id || ''
      }} />
    </div>
    <label class="field">
      <span>Layout</span>
      <select bind:value={layout}>
        {#each store.layoutsFor(format) as l}<option value={l.id}>{l.id}</option>{/each}
        <option value="">None (full MJML document)</option>
      </select>
    </label>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={() => (open = false)}>Cancel</button>
      <button type="submit" class="primary">Create</button>
    </div>
  </form>
</dialog>

<style>
  dialog { border: 1px solid var(--border); border-radius: 10px; padding: 0; width: min(420px, calc(100vw - 32px)); box-shadow: 0 20px 50px rgba(0,0,0,.2); }
  dialog::backdrop { background: rgba(24,24,27,.35); }
  form { padding: 16px 18px; }
  h3 { margin: 0 0 12px; font-size: 15px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .error { color: var(--danger); margin: 4px 0; }
</style>
