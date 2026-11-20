<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  let { open = $bindable(false) } = $props()
  let dialog = $state()
  let id = $state('')
  let layout = $state('')
  let error = $state('')

  $effect(() => {
    if (!dialog) return
    if (open && !dialog.open) { error = ''; layout = store.project?.layouts?.[0] || ''; dialog.showModal() }
    if (!open && dialog.open) dialog.close()
  })

  async function submit(e) {
    e.preventDefault()
    try {
      const t = await api.create(id.trim(), layout || undefined)
      open = false
      id = ''
      await store.refreshTemplates()
      await store.open(t.id)
      store.notify(`Plantilla ${t.id} creada`)
    } catch (err) {
      error = err.message
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
  <form onsubmit={submit}>
    <h3>Nueva plantilla</h3>
    <label class="field">
      <span>Identificador (carpeta/nombre)</span>
      <input class="mono" placeholder="customers/welcome" bind:value={id} required pattern="[\w.\-]+(/[\w.\-]+)*" />
    </label>
    <label class="field">
      <span>Layout</span>
      <select bind:value={layout}>
        {#each store.project?.layouts || [] as l}<option value={l}>{l}</option>{/each}
        <option value="">Ninguno (documento MJML completo)</option>
      </select>
    </label>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={() => (open = false)}>Cancelar</button>
      <button type="submit" class="primary">Crear</button>
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
