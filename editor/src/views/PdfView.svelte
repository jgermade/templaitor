<script>
  // PDF real del borrador con los datos de demo (se regenera al editar) + motor y validación veraPDF
  import { untrack } from 'svelte'
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  let url = $state(null)
  let loading = $state(false)
  let error = $state(null)
  let seq = 0

  const engines = $derived(store.project?.pdf?.engines || [])
  const configured = $derived(store.pdfSettings.engine || store.project?.pdf?.configured || 'auto')
  const draft = () => ({ kind: store.kind, name: store.doc.name, mjml: store.doc.mjml, yml: store.doc.yml, data: store.doc.data, lang: store.lang, engine: store.pdfEngine || undefined })

  $effect(() => {
    if (!store.doc) return
    const d = draft()
    const n = ++seq
    // la validación anterior deja de corresponder al PDF (sin suscribirse a ella)
    untrack(() => {
      const v = store.pdfValidation
      if (v?.status === 'done' && !v.stale && n > 1) store.pdfValidation = { ...v, stale: true }
    })
    const t = setTimeout(async () => {
      loading = true
      try {
        const { blob, engine } = await api.pdf(d)
        if (n !== seq) return
        if (url) URL.revokeObjectURL(url)
        url = URL.createObjectURL(blob)
        store.pdfEngineUsed = engine
        error = null
      } catch (e) {
        if (n === seq) error = e.message
      } finally {
        if (n === seq) loading = false
      }
    }, url ? 900 : 0)
    return () => clearTimeout(t)
  })

  $effect(() => () => url && URL.revokeObjectURL(url))

  async function validate() {
    store.pdfValidation = { status: 'running' }
    try {
      const r = await api.validatePdf(draft())
      store.pdfValidation = { status: 'done', result: r.validation, engine: r.engine, locale: r.locale }
    } catch (e) {
      store.pdfValidation = { status: 'error', error: e.message }
    }
  }
</script>

<div class="pdf">
  <div class="toolbar" role="toolbar" aria-label="Opciones del PDF">
    <label>
      Motor
      <select value={store.pdfEngine || ''} onchange={(e) => (store.pdfEngine = e.currentTarget.value || null)}>
        <option value="">Por defecto ({configured})</option>
        {#each engines as e}
          <option value={e.id} disabled={!e.available}>{e.label}{e.pdfua ? ' · PDF/UA' : ' · sin PDF/UA'}{e.available ? '' : ' (no instalado)'}</option>
        {/each}
      </select>
    </label>
    {#if store.pdfEngineUsed}
      {@const used = engines.find(e => e.id === store.pdfEngineUsed)}
      <span class="badge" class:ok={used?.pdfua} class:no={used && !used.pdfua}>
        {used?.label ?? store.pdfEngineUsed}{used?.pdfua ? ' · PDF/UA-1' : ' · no genera PDF/UA'}
      </span>
    {/if}
    <span class="grow"></span>
    <button onclick={validate} disabled={store.pdfValidation?.status === 'running' || !store.project?.pdf?.verapdf}
      title={store.project?.pdf?.verapdf ? `Validar con ${store.project.pdf.verapdf}` : 'veraPDF no disponible (make verapdf)'}>
      {store.pdfValidation?.status === 'running' ? 'Validando…' : '✓ Validar PDF/UA (veraPDF)'}
    </button>
    {#if url}
      <a class="download" href={url} download={`${store.doc.name}.${store.project?.locales?.[store.lang] || store.lang}.pdf`}>⤓ Descargar</a>
    {/if}
  </div>
  <div class="frame">
    {#if error}
      <div class="error">
        <b>No se pudo generar el PDF</b>
        <p class="mono">{error}</p>
      </div>
    {:else if url}
      <iframe title="PDF" src={url}></iframe>
    {/if}
    {#if loading}<div class="loading"><span class="spinner"></span> Generando PDF…</div>{/if}
  </div>
</div>

<style>
  .pdf { display: flex; flex-direction: column; height: 100%; background: #e4e4e7; }
  .toolbar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--panel); border-bottom: 1px solid var(--border); font-size: 12px; }
  .toolbar label { display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .toolbar select { font-size: 12px; }
  .badge { white-space: nowrap; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #f4f4f5; color: #3f3f46; }
  .badge.ok { background: #dcfce7; color: #166534; }
  .badge.no { background: #fef3c7; color: #92400e; }
  .grow { flex: 1; }
  .download { white-space: nowrap; background: var(--accent); color: #fff; text-decoration: none; padding: 4px 12px; border-radius: 6px; font-weight: 600; }
  .frame { position: relative; flex: 1; min-height: 0; }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  .loading {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center;
    background: #18181b; color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 12px;
  }
  .spinner { width: 12px; height: 12px; border: 2px solid #52525b; border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { padding: 32px; color: var(--danger); }
  .error p { color: var(--text); white-space: pre-wrap; }
</style>
