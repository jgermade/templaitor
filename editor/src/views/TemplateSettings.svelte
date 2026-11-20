<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  const comp = $derived(store.isComponent ? store.components.find(c => c.id === store.doc.id) : null)

  async function remove() {
    const what = store.isComponent ? 'el componente' : 'la plantilla'
    const extra = comp?.usedBy.length ? `\n\nSe usa en: ${comp.usedBy.map(u => u.id).join(', ')}` : ''
    if (!confirm(`¿Eliminar ${what} ${store.doc.id}? Esta acción borra sus ficheros.${extra}`)) return
    try {
      await api.remove(store.doc.id, store.kind)
      const back = store.returnTo
      store.saved = store.doc = null
      await store.refreshTemplates()
      const next = back || store.templates[0]?.id
      if (next) await store.open(next)
    } catch (e) { store.notify(e.message, 'error') }
  }
</script>

{#if store.doc}
  <div class="wrap">
    {#if comp}
      <p class="muted">Se inserta con <code>$import({comp.importPath})</code>. Sus textos viven en <code>{comp.name}.yml</code>; una plantilla puede sobrescribir cualquier clave en su propio <code>.yml</code>.</p>
      <div class="field"><span>Usado en</span>
        {#each comp.usedBy as u}<div class="mono">{u.kind === 'layout' ? '⧉' : '@'} {u.id}</div>{:else}<div class="muted">Ninguna plantilla</div>{/each}
      </div>
    {:else}
      <label class="field">
        <span>Layout</span>
        <select value={store.frontmatter.layout || ''} onchange={(e) => store.setLayout(e.currentTarget.value)} disabled={!store.isFragment}>
          {#if !store.isFragment}<option value="">— documento MJML completo —</option>{/if}
          {#each store.project?.layouts || [] as l}<option value={l}>{l}</option>{/each}
        </select>
      </label>
    {/if}

    {#if store.missing.length}
      <div class="field"><span>Traducciones pendientes</span>
        {#each store.missing as m}<div class="miss"><span class="mono">{m.lang}</span> · <code>{m.key}</code></div>{/each}
      </div>
    {/if}

    <ul class="help muted">
      <li>Click en un bloque para seleccionarlo; en textos y botones se escribe directamente.</li>
      <li>Doble click en un componente (◆) para editarlo.</li>
      <li><code>{'{{ variable }}'}</code> crea una variable Jinja2.</li>
      <li><kbd>Supr</kbd> elimina · <kbd>Ctrl+Z</kbd> deshace · <kbd>Ctrl+S</kbd> guarda.</li>
    </ul>

    <button class="danger del" onclick={remove}>Eliminar {store.isComponent ? 'componente' : 'plantilla'}</button>
  </div>
{/if}

<style>
  .wrap { padding: 0 14px; font-size: 12px; }
  .wrap p { margin: 0 0 10px; }
  .miss { color: var(--danger); }
  .help { list-style: none; padding: 0; margin: 4px 0 8px; }
  .help li { margin-bottom: 4px; }
  kbd { font: 11px var(--mono); border: 1px solid var(--border); border-radius: 3px; padding: 0 3px; }
  .del { width: 100%; }
</style>
