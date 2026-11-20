<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  let { onnew } = $props()

  const groups = $derived.by(() => {
    const g = {}
    for (const t of store.templates) (g[t.group || '—'] ??= []).push(t)
    return Object.entries(g)
  })

  const VIEWS = [
    ['design', 'Diseño'],
    ['preview', 'Vista previa'],
    ['text', 'Texto'],
    ['code', 'Código'],
  ]

  async function sendTest() {
    const to = prompt('Enviar prueba a:', localStorage.getItem('tpl:send-to') || '')
    if (!to) return
    try { localStorage.setItem('tpl:send-to', to) } catch {}
    try {
      await api.send({ mjml: store.doc.mjml, yml: store.doc.yml, data: store.doc.data, lang: store.lang, to })
      store.notify(`Enviado a ${to}`)
    } catch (e) {
      store.notify(e.message, 'error')
    }
  }

  async function select(e) {
    const id = e.currentTarget.value
    const ok = await store.open(id)
    if (!ok) e.currentTarget.value = store.doc?.id
  }
</script>

<header>
  <div class="brand" title={store.project?.name}>
    <svg width="22" height="22" viewBox="0 0 72 72" aria-hidden="true"><rect width="72" height="72" rx="16" fill="#4F46E5"/><path d="M20 24h32v6H39v20h-6V30H20z" fill="#fff"/></svg>
    <b>templaitor</b>
  </div>

  <select class="tpl-select" value={store.doc?.id} onchange={select} aria-label="Plantilla">
    {#each groups as [group, items]}
      <optgroup label={group}>
        {#each items as t}<option value={t.id}>{t.name}</option>{/each}
      </optgroup>
    {/each}
  </select>
  <button class="ghost" onclick={onnew} title="Nueva plantilla">＋</button>

  <div class="seg langs" role="group" aria-label="Idioma">
    {#each store.langs as l}
      <button class:active={store.lang === l} onclick={() => (store.lang = l)} title={store.project?.locales?.[l] || l}>{l}</button>
    {/each}
  </div>

  <div class="spacer"></div>

  <div class="seg" role="group" aria-label="Vista">
    {#each VIEWS as [v, label]}
      <button class:active={store.view === v} onclick={() => (store.view = v)}>{label}</button>
    {/each}
  </div>

  <div class="seg" role="group" aria-label="Dispositivo">
    <button class:active={store.device === 'desktop'} onclick={() => (store.device = 'desktop')} title="Escritorio">🖥</button>
    <button class:active={store.device === 'mobile'} onclick={() => (store.device = 'mobile')} title="Móvil">📱</button>
  </div>

  <div class="spacer"></div>

  <button class="ghost" disabled={!store.history.length} onclick={() => store.undo()} title="Deshacer (Ctrl+Z)">↶</button>
  <button class="ghost" disabled={!store.future.length} onclick={() => store.redo()} title="Rehacer (Ctrl+Shift+Z)">↷</button>
  {#if store.project?.smtp}
    <button onclick={sendTest} title="Enviar prueba por SMTP">✉ Enviar</button>
  {/if}
  <button onclick={() => store.compile()} title="Compilar a {store.project?.outDir}/">⚙ Compilar</button>
  <button class="primary" disabled={!store.dirty} onclick={() => store.save()} title="Guardar (Ctrl+S)">
    {store.dirty ? 'Guardar •' : 'Guardado'}
  </button>
</header>

<style>
  header {
    height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
    background: var(--panel); border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 6px; margin-right: 8px; font-size: 14px; }
  .tpl-select { min-width: 200px; font-weight: 500; }
  .spacer { flex: 1; }
  .langs button { font-family: var(--mono); font-size: 12px; text-transform: uppercase; }
</style>
