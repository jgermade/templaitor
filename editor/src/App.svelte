<script>
  import { onMount } from 'svelte'
  import Topbar from './views/Topbar.svelte'
  import Outline from './views/Outline.svelte'
  import Canvas from './views/Canvas.svelte'
  import Inspector from './views/Inspector.svelte'
  import CodeView from './views/CodeView.svelte'
  import PreviewView from './views/PreviewView.svelte'
  import NewTemplateDialog from './views/NewTemplateDialog.svelte'
  import Toast from './components/Toast.svelte'
  import { store } from './stores/editor.svelte.js'
  import { api } from './lib/api.js'

  let error = $state(null)
  let showNew = $state(false)
  let showIssues = $state(false)

  onMount(() => {
    store.init().catch((e) => (error = e.message))
  })

  // Vista previa: se recalcula (con debounce) ante cualquier cambio del borrador
  let seq = 0
  $effect(() => {
    if (!store.doc) return
    const draft = {
      mjml: store.doc.mjml,
      yml: store.doc.yml,
      data: store.doc.data,
      lang: store.lang,
      mode: store.view === 'design' ? 'design' : 'preview',
    }
    void store.previewNonce
    const n = ++seq
    const t = setTimeout(async () => {
      store.loadingPreview = true
      try {
        const r = await api.preview(draft)
        if (n === seq) store.preview = r
      } catch (e) {
        if (n === seq) store.preview = { ...store.preview, errors: [e.message] }
      } finally {
        if (n === seq) store.loadingPreview = false
      }
    }, 160)
    return () => clearTimeout(t)
  })

  const issues = $derived([
    ...(store.preview.errors || []).map(m => ({ level: 'error', m })),
    ...(store.preview.warnings || []).map(m => ({ level: 'warn', m })),
    ...store.missing.map(x => ({ level: 'warn', m: `Falta $t('${x.key}') en ${x.lang}` })),
  ])

  function isTyping(e) {
    const t = e.target
    return t.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]')
  }

  function onKeydown(e) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); store.save(); return }
    if (isTyping(e)) return
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo() }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo() }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId && store.view === 'design') { e.preventDefault(); store.removeSelected() }
    else if (e.key === 'Escape') store.selectedId = null
  }

  function onBeforeUnload(e) {
    if (store.dirty) { e.preventDefault(); e.returnValue = '' }
  }
</script>

<svelte:window onkeydown={onKeydown} onbeforeunload={onBeforeUnload} />

{#if error}
  <div class="fatal">
    <h2>No se pudo cargar el proyecto</h2>
    <p class="mono">{error}</p>
  </div>
{:else}
  <div class="app">
    <Topbar onnew={() => (showNew = true)} />

    {#if store.doc && store.view !== 'code'}
      <div class="subject">
        <span class="label">Asunto</span>
        {#if store.view === 'design'}
          <input
            value={store.i18n.subject?.[store.lang] ?? ''}
            placeholder="Asunto del email ({store.lang})"
            oninput={(e) => store.setSubject(store.lang, e.currentTarget.value)}
          />
        {:else}
          <span class="rendered">{store.preview.subject}</span>
        {/if}
        {#if store.loadingPreview}<span class="spinner" aria-label="Actualizando"></span>{/if}
      </div>
    {/if}

    <main>
      {#if !store.doc}
        <div class="empty-state">
          {#if store.project && !store.templates.length}
            <p>No hay plantillas en <code>{store.project.templatesDir}/</code>.</p>
            <button class="primary" onclick={() => (showNew = true)}>Crear la primera plantilla</button>
          {:else}
            <p class="muted">Cargando…</p>
          {/if}
        </div>
      {:else if store.view === 'design'}
        <div class="design">
          <Outline />
          <div class="canvas-wrap"><Canvas mode="design" /></div>
          <Inspector />
        </div>
      {:else if store.view === 'code'}
        <CodeView />
      {:else}
        <PreviewView />
      {/if}
    </main>

    <footer>
      <span class="mono muted">{store.doc?.id ?? ''}</span>
      {#if store.doc}<span class="muted">· {store.project?.locales?.[store.lang] || store.lang}</span>{/if}
      <span class="grow"></span>
      <button class="ghost issues" class:has={issues.length} onclick={() => (showIssues = !showIssues)}>
        {issues.length ? `⚠ ${issues.length} aviso(s)` : '✓ Sin avisos'}
      </button>
      {#if showIssues && issues.length}
        <ul class="issue-list">
          {#each issues as i}<li class={i.level}>{i.m}</li>{/each}
        </ul>
      {/if}
    </footer>
  </div>
{/if}

<NewTemplateDialog bind:open={showNew} />
<Toast toast={store.toast} />

<style>
  .app { display: flex; flex-direction: column; height: 100vh; }
  main { flex: 1; min-height: 0; }
  .design { display: grid; grid-template-columns: 280px minmax(0, 1fr) 320px; height: 100%; min-height: 0; }
  .canvas-wrap { min-width: 0; min-height: 0; }
  .subject {
    display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 12px;
    background: var(--panel-2); border-bottom: 1px solid var(--border);
  }
  .subject .label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); }
  .subject input { flex: 1; max-width: 640px; border-color: transparent; background: transparent; font-weight: 500; }
  .subject input:hover { border-color: var(--border); background: #fff; }
  .subject .rendered { font-weight: 500; }
  .spinner { width: 12px; height: 12px; border: 2px solid #c7d2fe; border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer {
    position: relative; display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 26px; flex: none;
    background: var(--panel); border-top: 1px solid var(--border); font-size: 11px;
  }
  .grow { flex: 1; }
  .issues { font-size: 11px; padding: 0 6px; color: var(--ok); }
  .issues.has { color: var(--warn); }
  .issue-list {
    position: absolute; right: 8px; bottom: 28px; margin: 0; padding: 8px 12px; list-style: none; z-index: 20;
    background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
    max-height: 50vh; overflow: auto; width: min(520px, 90vw); font-size: 12px;
  }
  .issue-list li { padding: 3px 0; }
  .issue-list .error { color: var(--danger); }
  .issue-list .warn { color: var(--warn); }
  .empty-state { display: grid; place-content: center; gap: 12px; height: 100%; text-align: center; }
  .fatal { padding: 40px; }
</style>
