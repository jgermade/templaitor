<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  let newLang = $state('')

  async function remove() {
    if (!confirm(`¿Eliminar la plantilla ${store.doc.id}? Esta acción borra sus ficheros.`)) return
    try {
      await api.remove(store.doc.id)
      store.saved = store.doc = null
      await store.refreshTemplates()
      if (store.templates[0]) await store.open(store.templates[0].id)
    } catch (e) { store.notify(e.message, 'error') }
  }
</script>

{#if store.doc}
  <div class="wrap">
    <div class="panel-title">Plantilla</div>
    <p class="id mono">{store.doc.id}</p>

    <label class="field">
      <span>Layout</span>
      <select value={store.frontmatter.layout || ''} onchange={(e) => store.setLayout(e.currentTarget.value)} disabled={!store.isFragment}>
        {#if !store.isFragment}<option value="">— documento MJML completo —</option>{/if}
        {#each store.project?.layouts || [] as l}<option value={l}>{l}</option>{/each}
      </select>
    </label>

    <div class="panel-title">Asunto</div>
    {#each store.langs as l}
      <label class="field">
        <span class="mono">{l}</span>
        <input value={store.i18n.subject?.[l] ?? ''} oninput={(e) => store.setSubject(l, e.currentTarget.value)} />
      </label>
    {/each}

    <div class="panel-title">Idiomas</div>
    <ul class="langs">
      {#each store.langs as l}
        <li>
          <span class="mono">{l}</span>
          <span class="muted">{store.project?.locales?.[l] || ''}</span>
          <span class="grow"></span>
          <button class="ghost danger" title="Eliminar idioma" disabled={store.langs.length < 2} onclick={() => store.removeLang(l)}>✕</button>
        </li>
      {/each}
    </ul>
    <form class="add" onsubmit={(e) => { e.preventDefault(); store.addLang(newLang.trim(), store.lang); newLang = '' }}>
      <input class="mono" placeholder="fr" bind:value={newLang} list="tpl-langs" />
      <datalist id="tpl-langs">
        {#each Object.keys(store.project?.locales || {}) as l}<option value={l}></option>{/each}
      </datalist>
      <button type="submit" disabled={!newLang.trim()}>Añadir (copia de {store.lang})</button>
    </form>

    {#if store.missing.length}
      <div class="panel-title">Traducciones pendientes</div>
      <ul class="missing">
        {#each store.missing as m}
          <li><span class="mono">{m.lang}</span> · <code>{m.key}</code></li>
        {/each}
      </ul>
    {/if}

    <div class="panel-title">Ayuda</div>
    <ul class="help muted">
      <li>Haz click en un bloque del lienzo para seleccionarlo; en textos y botones puedes escribir directamente.</li>
      <li>Escribe <code>{'{{ variable }}'}</code> para insertar una variable Jinja2.</li>
      <li>Los textos con 🌐 se guardan en el <code>.yml</code> del idioma activo.</li>
      <li><kbd>Supr</kbd> elimina · <kbd>Ctrl+Z</kbd> deshace · <kbd>Ctrl+S</kbd> guarda.</li>
    </ul>

    <button class="danger del" onclick={remove}>Eliminar plantilla</button>
  </div>
{/if}

<style>
  .wrap { padding: 0 12px 24px; }
  .wrap .panel-title { padding-left: 0; }
  .id { margin: 0 0 8px; color: var(--muted); }
  .langs, .missing, .help { list-style: none; padding: 0; margin: 0 0 8px; }
  .langs li { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  .grow { flex: 1; }
  .add { display: grid; grid-template-columns: 70px 1fr; gap: 6px; }
  .missing li { color: var(--danger); font-size: 12px; }
  .help li { font-size: 12px; margin-bottom: 4px; }
  kbd { font: 11px var(--mono); border: 1px solid var(--border); border-radius: 3px; padding: 0 3px; }
  .del { margin-top: 12px; width: 100%; }
</style>
