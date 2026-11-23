<script>
  import Icon from '../components/Icon.svelte'
  import Choice from '../components/Choice.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'
  import { defaultFilename } from '@shared/attachments.js'

  const comp = $derived(store.isComponent ? store.components.find(c => c.id === store.doc.id) : null)
  const lay = $derived(store.isLayout ? store.layouts.find(l => l.id === store.doc.id) : null)
  const pdfTemplates = $derived(store.templates.filter(t => t.format === 'pdf'))

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
      <div class="field">
        <span>Format</span>
        <Choice label="Layout format" size="sm" value={store.frontmatter.format === 'pdf' ? 'pdf' : 'email'}
          onchange={(v) => store.setFrontmatter(['format'], v)} options={[{ value: 'email', label: 'Email', icon: 'email', color: '#2563eb' }, { value: 'pdf', label: 'PDF document', icon: 'pdf', color: '#dc2626' }]} />
      </div>
      <p class="muted">Offered to {store.frontmatter.format === 'pdf' ? 'PDF documents' : 'emails'}.
Templates use it with <code>layout: {lay.id}</code> in their frontmatter; their content goes into <code>$content</code>.</p>
      <div class="field"><span>Used by</span>
        {#each lay.usedBy as u}
          <button class="ghost uselink mono" onclick={() => store.open(u.id)}>@ {u.id}</button>
        {:else}<div class="muted">No templates</div>{/each}
      </div>
    {:else if comp}
      <p class="muted">Inserted with <code>$import({comp.importPath})</code>. Its texts live in <code>{comp.name}.yml</code>; a template can override any key in its own <code>.yml</code>.</p>
      <div class="field"><span>Used by</span>
        {#each comp.usedBy as u}<div class="mono"><Icon name={u.kind === 'layout' ? 'layout' : 'template'} size={12} /> {u.id}</div>{:else}<div class="muted">No templates</div>{/each}
      </div>
    {:else}
      <div class="field">
        <span>Format</span>
        <Choice label="Format" size="sm" value={store.isPdf ? 'pdf' : 'email'} onchange={(v) => store.setFormat(v)}
          options={[{ value: 'email', label: 'Email', icon: 'email', color: '#2563eb' }, { value: 'pdf', label: 'PDF document', icon: 'pdf', color: '#dc2626' }]} />
      </div>
      {#if store.isPdf}
        <div class="pdfgrid">
          <label class="field"><span>Size</span>
            <select value={store.pdfSettings.size || 'A4'} onchange={(e) => store.setFrontmatter(['pdf', 'size'], e.currentTarget.value)}>
              {#each ['A4', 'A5', 'A3', 'Letter', 'Legal'] as s}<option value={s}>{s}</option>{/each}
            </select>
          </label>
          <div class="field"><span>Orientation</span>
            <Choice label="Orientation" size="sm" value={store.pdfSettings.orientation || 'portrait'} onchange={(v) => store.setFrontmatter(['pdf', 'orientation'], v)}
              options={[{ value: 'portrait', label: 'Portrait', icon: 'portrait' }, { value: 'landscape', label: 'Landscape', icon: 'landscape' }]} />
          </div>
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
            {#each store.layoutsFor(store.isPdf ? 'pdf' : 'email') as l}<option value={l.id}>{l.id}</option>{/each}
            {#if store.frontmatter.layout && !store.layoutsFor(store.isPdf ? 'pdf' : 'email').some(l => l.id === store.frontmatter.layout)}
              <option value={store.frontmatter.layout}>{store.frontmatter.layout} (not {store.isPdf ? 'a PDF' : 'an email'} layout)</option>
            {/if}
          </select>
          {#if store.frontmatter.layout}
            <button title="Edit layout" aria-label="Edit layout" onclick={() => store.openLayout(store.frontmatter.layout)}><Icon name="pencil" size={13} /></button>
          {/if}
        </div>
      </label>
      {#if !store.isPdf}
        <div class="field" role="group" aria-labelledby="att-title"><span id="att-title">Attachments</span>
          {#each store.attachments as a, i (i)}
            <div class="att">
              <div class="atthead">
                <span><Icon name="paperclip" size={13} /> {a.type === 'url' ? 'Remote file' : a.type === 'template' ? 'Local PDF' : 'Invalid entry'}</span>
                <button class="ghost" aria-label={`Remove attachment ${i + 1}`} title="Remove" onclick={() => store.removeAttachment(i)}><Icon name="x" size={13} /></button>
              </div>
              {#if a.type === 'url'}
                <label class="field"><span>URL</span>
                  <input class="mono" value={a.ref} placeholder="https://example.com/terms-$lang.pdf" oninput={(e) => store.setAttachment(i, 'url', e.currentTarget.value)} />
                </label>
              {:else if a.type === 'template'}
                <label class="field"><span>Template</span>
                  <select value={a.ref} onchange={(e) => store.setAttachment(i, 'template', e.currentTarget.value)}>
                    {#if !pdfTemplates.some(t => t.id === a.ref)}<option value={a.ref}>{a.ref} (not a PDF template)</option>{/if}
                    {#each pdfTemplates as t}<option value={t.id}>{t.id}</option>{/each}
                  </select>
                </label>
                <label class="field"><span>Context (email variable)</span>
                  <input class="mono" value={a.context} placeholder="whole email context" oninput={(e) => store.setAttachment(i, 'context', e.currentTarget.value)} />
                </label>
              {/if}
              {#if a.type !== 'invalid'}
                <label class="field"><span>File name</span>
                  <input class="mono" value={a.filename} placeholder={defaultFilename(a)} oninput={(e) => store.setAttachment(i, 'filename', e.currentTarget.value)} />
                </label>
              {:else}
                <p class="muted tip">Fix it in the Code view: use <code>template:</code> or <code>url:</code>.</p>
              {/if}
            </div>
          {:else}<div class="muted">No attachments</div>{/each}
          <div class="attadd">
            <button onclick={() => store.addAttachment({ template: pdfTemplates[0].id })} disabled={!pdfTemplates.length} title={pdfTemplates.length ? 'Attach a PDF template of this project' : 'There are no PDF templates'}><Icon name="plus" size={13} /> Local PDF</button>
            <button onclick={() => store.addAttachment({ url: 'https://' })}><Icon name="plus" size={13} /> Remote file</button>
          </div>
          <p class="muted tip">Local PDFs are rendered in the email's language. <code>$lang</code>, <code>$t()</code> and <code>{'{{ }}'}</code> work in URLs and file names.</p>
        </div>
      {/if}
    {/if}

    {#if store.missing.length}
      <div class="field"><span>Missing translations</span>
        {#each store.missing as m}<div class="miss"><span class="mono">{m.lang}</span> · <code>{m.key}</code></div>{/each}
      </div>
    {/if}

    <ul class="help muted">
      <li>Click a block to select it; type directly into texts and buttons.</li>
      <li>Double-click a component (<Icon name="component" size={9} label="component" />) to edit it.</li>
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
  .att { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px 0; margin-bottom: 6px; }
  .atthead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-weight: 600; }
  .atthead button { padding: 0 4px; }
  .attadd { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 4px; }
  .uselink { display: block; padding: 2px 0; font-size: 12px; color: #2563eb; }
</style>
