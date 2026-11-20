<script>
  import { onMount } from 'svelte'
  import Topbar from './views/Topbar.svelte'
  import Sidebar from './views/Sidebar.svelte'
  import Canvas from './views/Canvas.svelte'
  import Inspector from './views/Inspector.svelte'
  import CodeView from './views/CodeView.svelte'
  import PdfView from './views/PdfView.svelte'
  import A11yReport from './views/A11yReport.svelte'
  import NewTemplateDialog from './views/NewTemplateDialog.svelte'
  import Toast from './components/Toast.svelte'
  import DialogHost from './components/DialogHost.svelte'
  import { store } from './stores/editor.svelte.js'
  import { api } from './lib/api.js'

  let error = $state(null)
  let showNew = $state(false)
  let showIssues = $state(false)
  let showText = $state(false)

  onMount(() => {
    store.init().catch((e) => (error = e.message))
  })

  // Preview: recomputed (debounced) on any change of the draft
  let seq = 0
  $effect(() => {
    if (!store.doc) return
    const draft = {
      kind: store.kind,
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
    ...store.missing.map(x => ({ level: 'warn', m: `Missing $t('${x.key}') in ${x.lang}` })),
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
    <h2>Could not load the project</h2>
    <p class="mono">{error}</p>
  </div>
{:else}
  <div class="app">
    <Topbar onnew={() => (showNew = true)} />

    {#if store.doc && store.view !== 'code'}
      <div class="subject">
        <span class="label">{store.isComponent ? 'Component' : store.isLayout ? 'Layout' : store.isPdf ? 'Title' : 'Subject'}</span>
        {#if store.isComponent}
          <span class="rendered muted">◆ {store.doc.name} — preview with the layout &lt;mj-head&gt;</span>
        {:else if store.isLayout}
          <span class="rendered muted">⧉ {store.doc.id} — the dashed slot is <code>$content</code>, where each template goes</span>
        {:else if store.view === 'design'}
          <input
            value={store.i18n.subject?.[store.lang] ?? ''}
            placeholder={store.isPdf ? `Document title (${store.lang})` : `Email subject (${store.lang})`}
            oninput={(e) => store.setSubject(store.lang, e.currentTarget.value)}
          />
        {:else}
          <span class="rendered">{store.preview.subject}</span>
        {/if}
        {#if store.loadingPreview}<span class="spinner" aria-label="Updating"></span>{/if}
        <span class="grow"></span>
        {#if store.preview.a11yReport}
          {@const vp = store.view === 'pdf' && store.pdfValidation?.status === 'done' && !store.pdfValidation.stale ? store.pdfValidation.result : null}
          {@const fails = store.preview.a11yReport.checks.filter(c => c.status === 'fail').length + (vp && !vp.compliant ? 1 : 0)}
          {@const warns = store.preview.a11yReport.checks.filter(c => c.status === 'warn').length}
          <button class="ghost a11y" class:bad={fails} class:warn={!fails && warns} onclick={() => { if (store.view !== 'preview' && store.view !== 'pdf') store.view = 'preview' }} title="Accessibility report (WCAG 2.1 AA)">
            ♿ {fails ? `${fails} ✕` : warns ? `${warns} ⚠` : '✓'}
          </button>
        {/if}
        <div class="issues-wrap">
          <button class="ghost issues" class:has={issues.length} onclick={() => (showIssues = !showIssues)}>
            {issues.length ? `⚠ ${issues.length}` : '✓'}
          </button>
          {#if showIssues && issues.length}
            <ul class="issue-list">
              {#each issues as i}<li class={i.level}>{i.m}</li>{/each}
            </ul>
          {/if}
        </div>
        <button class="ghost tab-btn" onclick={() => store.openPreviewTab()} title="Open the preview in a new tab">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>
        </button>
        {#if !store.isPdf}<label class="text-toggle">text <input type="checkbox" bind:checked={showText} /></label>{/if}
      </div>
    {/if}

    <main>
      {#if !store.doc}
        <div class="empty-state">
          {#if store.project && !store.templates.length}
            <p>There are no templates in <code>{store.project.templatesDir}/</code>.</p>
            <button class="primary" onclick={() => (showNew = true)}>Create the first template</button>
          {:else}
            <p class="muted">Loading…</p>
          {/if}
        </div>
      {:else if store.view === 'code'}
        <CodeView />
      {:else}
        {@const report = store.view === 'preview' || store.view === 'pdf'}
        <div class="layout" class:with-inspector={(store.view === 'design' && store.selected && !showText) || report}>
          <Sidebar />
          <div class="center">
            {#if store.view === 'pdf'}
              <PdfView />
            {:else if showText && !store.isPdf}
              <pre class="text">{store.preview.text}</pre>
            {:else}
              <Canvas mode={store.view === 'design' ? 'design' : 'preview'} />
            {/if}
          </div>
          {#if report}
            <A11yReport />
          {:else if store.view === 'design' && store.selected && !showText}
            <Inspector />
          {/if}
        </div>
      {/if}
    </main>
  </div>
{/if}

<NewTemplateDialog bind:open={showNew} />
<Toast toast={store.toast} />
<DialogHost />

<style>
  .app { display: flex; flex-direction: column; height: 100vh; }
  main { flex: 1; min-height: 0; }
  .layout { display: grid; grid-template-columns: 400px minmax(0, 1fr); height: 100%; min-height: 0; }
  .layout.with-inspector { grid-template-columns: 400px minmax(0, 1fr) 340px; }
  .a11y { font-size: 12px; padding: 2px 8px; color: var(--ok); font-weight: 600; }
  .a11y.warn { color: var(--warn); }
  .a11y.bad { color: var(--danger); }
  .center { min-width: 0; min-height: 0; overflow: auto; background: #f4f4f5; }
  .subject {
    display: flex; align-items: center; gap: 14px; height: 52px; padding: 0 20px; flex: none;
    background: #f4f4f5; border-bottom: 1px solid #e4e4e7; font-size: 15px;
  }
  .subject .label { color: #3f3f46; min-width: 76px; }
  .subject input { flex: 1; max-width: 760px; border-color: transparent; background: transparent; font-size: 15px; padding: 4px 6px; }
  .subject input:hover { border-color: var(--border); background: #fff; }
  .subject .rendered { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grow { flex: 1; }
  .tab-btn { padding: 3px 6px; color: #52525b; display: grid; place-content: center; }
  .text-toggle { display: flex; align-items: center; gap: 6px; color: #3f3f46; cursor: pointer; }
  .text-toggle input { width: 15px; height: 15px; margin: 0; }
  .spinner { width: 12px; height: 12px; flex: none; border: 2px solid #c7d2fe; border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .issues-wrap { position: relative; }
  .issues { font-size: 12px; padding: 2px 8px; color: var(--ok); }
  .issues.has { color: var(--warn); }
  .issue-list {
    position: absolute; right: 0; top: 30px; margin: 0; padding: 8px 12px; list-style: none; z-index: 20;
    background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
    max-height: 50vh; overflow: auto; width: min(520px, 90vw); font-size: 12px;
  }
  .issue-list li { padding: 3px 0; }
  .issue-list .error { color: var(--danger); }
  .issue-list .warn { color: var(--warn); }
  pre.text {
    margin: 24px auto; max-width: 680px; background: #fff; border: 1px solid var(--border); border-radius: 8px;
    padding: 20px 24px; white-space: pre-wrap; font: 13px/1.6 var(--mono);
  }
  .empty-state { display: grid; place-content: center; gap: 12px; height: 100%; text-align: center; }
  .fatal { padding: 40px; }
</style>
