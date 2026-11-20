<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'

  const comp = $derived(store.isComponent ? store.components.find(c => c.id === store.doc.id) : null)
  const lay = $derived(store.isLayout ? store.layouts.find(l => l.id === store.doc.id) : null)

  async function remove() {
    const what = store.isComponent ? 'component' : store.isLayout ? 'layout' : 'template'
    const users = comp?.usedBy ?? lay?.usedBy ?? []
    const extra = users.length ? `\n\nUsed by: ${users.map(u => u.id).join(', ')}` : ''
    if (!(await confirmDialog({
      title: `Delete ${what}`,
      message: `${store.doc.id}\n\nThis deletes its files.${extra}`,
      okLabel: 'Delete', danger: true,
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
      <p class="muted">Templates use it with <code>layout: {lay.id}</code> in their frontmatter; their content goes into <code>$content</code>.</p>
      <div class="field"><span>Used by</span>
        {#each lay.usedBy as u}
          <button class="ghost uselink mono" onclick={() => store.open(u.id)}>@ {u.id}</button>
        {:else}<div class="muted">No templates</div>{/each}
      </div>
    {:else if comp}
      <p class="muted">Inserted with <code>$import({comp.importPath})</code>. Its texts live in <code>{comp.name}.yml</code>; a template can override any key in its own <code>.yml</code>.</p>
      <div class="field"><span>Used by</span>
        {#each comp.usedBy as u}<div class="mono">{u.kind === 'layout' ? '⧉' : '@'} {u.id}</div>{:else}<div class="muted">No templates</div>{/each}
      </div>
    {:else}
      <label class="field">
        <span>Format</span>
        <select value={store.isPdf ? 'pdf' : 'email'} onchange={(e) => store.setFormat(e.currentTarget.value)}>
          <option value="email">Email</option>
          <option value="pdf">PDF document</option>
        </select>
      </label>
      {#if store.isPdf}
        <div class="pdfgrid">
          <label class="field"><span>Size</span>
            <select value={store.pdfSettings.size || 'A4'} onchange={(e) => store.setFrontmatter(['pdf', 'size'], e.currentTarget.value)}>
              {#each ['A4', 'A5', 'A3', 'Letter', 'Legal'] as s}<option value={s}>{s}</option>{/each}
            </select>
          </label>
          <label class="field"><span>Orientation</span>
            <select value={store.pdfSettings.orientation || 'portrait'} onchange={(e) => store.setFrontmatter(['pdf', 'orientation'], e.currentTarget.value)}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label class="field"><span>Margins</span>
            <input class="mono" value={typeof store.pdfSettings.margin === 'object' ? '' : store.pdfSettings.margin ?? ''} placeholder="15mm" oninput={(e) => store.setFrontmatter(['pdf', 'margin'], e.currentTarget.value)} />
          </label>
          <label class="field full"><span>Header</span>
            <input value={store.pdfSettings.header ?? ''} placeholder="{'{title}'}" oninput={(e) => store.setFrontmatter(['pdf', 'header'], e.currentTarget.value)} />
          </label>
          <label class="field full"><span>Footer</span>
            <input value={store.pdfSettings.footer ?? ''} placeholder="{'{page} / {pages}'}" oninput={(e) => store.setFrontmatter(['pdf', 'footer'], e.currentTarget.value)} />
          </label>
          <p class="full muted tip">Variables: <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{title}'}</code>. The layout width must fit the page (A4 with 15 mm margins: 680px).</p>
        </div>
      {/if}
      <label class="field">
        <span>Layout</span>
        <div class="layrow">
          <select value={store.frontmatter.layout || ''} onchange={(e) => store.setLayout(e.currentTarget.value)} disabled={!store.isFragment}>
            {#if !store.isFragment}<option value="">— full MJML document —</option>{/if}
            {#each store.layouts as l}<option value={l.id}>{l.id}</option>{/each}
          </select>
          {#if store.frontmatter.layout}
            <button title="Edit layout" onclick={() => store.openLayout(store.frontmatter.layout)}>✎</button>
          {/if}
        </div>
      </label>
    {/if}

    {#if store.missing.length}
      <div class="field"><span>Missing translations</span>
        {#each store.missing as m}<div class="miss"><span class="mono">{m.lang}</span> · <code>{m.key}</code></div>{/each}
      </div>
    {/if}

    <ul class="help muted">
      <li>Click a block to select it; type directly into texts and buttons.</li>
      <li>Double-click a component (◆) to edit it.</li>
      <li><code>{'{{ variable }}'}</code> creates a Jinja2 variable.</li>
      <li><kbd>Del</kbd> deletes · <kbd>Ctrl+Z</kbd> undoes · <kbd>Ctrl+S</kbd> saves.</li>
    </ul>

    <button class="danger del" onclick={remove}>Delete {store.isComponent ? 'component' : store.isLayout ? 'layout' : 'template'}</button>
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
