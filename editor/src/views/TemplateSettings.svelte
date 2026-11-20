<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'

  const comp = $derived(store.isComponent ? store.components.find(c => c.id === store.doc.id) : null)
  const lay = $derived(store.isLayout ? store.layouts.find(l => l.id === store.doc.id) : null)

  async function remove() {
    const what = store.isComponent ? 'el componente' : store.isLayout ? 'el layout' : 'la plantilla'
    const users = comp?.usedBy ?? lay?.usedBy ?? []
    const extra = users.length ? `\n\nSe usa en: ${users.map(u => u.id).join(', ')}` : ''
    if (!(await confirmDialog({
      title: `Eliminar ${what}`,
      message: `${store.doc.id}\n\nEsta acción borra sus ficheros.${extra}`,
      okLabel: 'Eliminar', danger: true,
    }))) return
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
    {#if lay}
      <p class="muted">Las plantillas lo usan con <code>layout: {lay.id}</code> en su frontmatter; su contenido se inserta en <code>$content</code>.</p>
      <div class="field"><span>Usado en</span>
        {#each lay.usedBy as u}
          <button class="ghost uselink mono" onclick={() => store.open(u.id)}>@ {u.id}</button>
        {:else}<div class="muted">Ninguna plantilla</div>{/each}
      </div>
    {:else if comp}
      <p class="muted">Se inserta con <code>$import({comp.importPath})</code>. Sus textos viven en <code>{comp.name}.yml</code>; una plantilla puede sobrescribir cualquier clave en su propio <code>.yml</code>.</p>
      <div class="field"><span>Usado en</span>
        {#each comp.usedBy as u}<div class="mono">{u.kind === 'layout' ? '⧉' : '@'} {u.id}</div>{:else}<div class="muted">Ninguna plantilla</div>{/each}
      </div>
    {:else}
      <label class="field">
        <span>Formato</span>
        <select value={store.isPdf ? 'pdf' : 'email'} onchange={(e) => store.setFormat(e.currentTarget.value)}>
          <option value="email">Email</option>
          <option value="pdf">Documento PDF</option>
        </select>
      </label>
      {#if store.isPdf}
        <div class="pdfgrid">
          <label class="field"><span>Tamaño</span>
            <select value={store.pdfSettings.size || 'A4'} onchange={(e) => store.setFrontmatter(['pdf', 'size'], e.currentTarget.value)}>
              {#each ['A4', 'A5', 'A3', 'Letter', 'Legal'] as s}<option value={s}>{s}</option>{/each}
            </select>
          </label>
          <label class="field"><span>Orientación</span>
            <select value={store.pdfSettings.orientation || 'portrait'} onchange={(e) => store.setFrontmatter(['pdf', 'orientation'], e.currentTarget.value)}>
              <option value="portrait">Vertical</option>
              <option value="landscape">Horizontal</option>
            </select>
          </label>
          <label class="field"><span>Márgenes</span>
            <input class="mono" value={typeof store.pdfSettings.margin === 'object' ? '' : store.pdfSettings.margin ?? ''} placeholder="15mm" oninput={(e) => store.setFrontmatter(['pdf', 'margin'], e.currentTarget.value)} />
          </label>
          <label class="field full"><span>Cabecera</span>
            <input value={store.pdfSettings.header ?? ''} placeholder="{'{title}'}" oninput={(e) => store.setFrontmatter(['pdf', 'header'], e.currentTarget.value)} />
          </label>
          <label class="field full"><span>Pie de página</span>
            <input value={store.pdfSettings.footer ?? ''} placeholder="{'{page} / {pages}'}" oninput={(e) => store.setFrontmatter(['pdf', 'footer'], e.currentTarget.value)} />
          </label>
          <p class="full muted tip">Variables: <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{title}'}</code> <code>{'{date}'}</code>. El ancho del layout debe caber en la página (A4 con 15 mm de margen: 680px).</p>
        </div>
      {/if}
      <label class="field">
        <span>Layout</span>
        <div class="layrow">
          <select value={store.frontmatter.layout || ''} onchange={(e) => store.setLayout(e.currentTarget.value)} disabled={!store.isFragment}>
            {#if !store.isFragment}<option value="">— documento MJML completo —</option>{/if}
            {#each store.layouts as l}<option value={l.id}>{l.id}</option>{/each}
          </select>
          {#if store.frontmatter.layout}
            <button title="Editar layout" onclick={() => store.openLayout(store.frontmatter.layout)}>✎</button>
          {/if}
        </div>
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

    <button class="danger del" onclick={remove}>Eliminar {store.isComponent ? 'componente' : store.isLayout ? 'layout' : 'plantilla'}</button>
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
  .pdfgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
  .pdfgrid .full { grid-column: 1 / -1; }
  .tip { margin: 0 0 8px; font-size: 11px; }
  .layrow { display: grid; grid-template-columns: 1fr auto; gap: 6px; }
  .uselink { display: block; padding: 2px 0; font-size: 12px; color: #2563eb; }
</style>
