<script>
  // PDF real (Chromium) del borrador con los datos de demo; se regenera al editar
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  let url = $state(null)
  let loading = $state(false)
  let error = $state(null)
  let seq = 0

  $effect(() => {
    if (!store.doc) return
    const draft = { kind: store.kind, name: store.doc.name, mjml: store.doc.mjml, yml: store.doc.yml, data: store.doc.data, lang: store.lang }
    const n = ++seq
    const t = setTimeout(async () => {
      loading = true
      try {
        const blob = await api.pdf(draft)
        if (n !== seq) return
        if (url) URL.revokeObjectURL(url)
        url = URL.createObjectURL(blob)
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
</script>

<div class="pdf">
  {#if error}
    <div class="error">
      <b>No se pudo generar el PDF</b>
      <p class="mono">{error}</p>
    </div>
  {:else if url}
    <iframe title="PDF" src={url}></iframe>
  {/if}
  {#if loading}<div class="loading"><span class="spinner"></span> Generando PDF…</div>{/if}
  {#if url}
    <a class="download" href={url} download={`${store.doc.name}.${store.project?.locales?.[store.lang] || store.lang}.pdf`}>⤓ Descargar PDF</a>
  {/if}
</div>

<style>
  .pdf { position: relative; height: 100%; background: #e4e4e7; }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  .loading {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center;
    background: #18181b; color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 12px;
  }
  .spinner { width: 12px; height: 12px; border: 2px solid #52525b; border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .download {
    position: absolute; right: 16px; bottom: 16px; background: var(--accent); color: #fff; text-decoration: none;
    padding: 7px 14px; border-radius: 8px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.18);
  }
  .error { padding: 32px; color: var(--danger); }
  .error p { color: var(--text); white-space: pre-wrap; }
</style>
