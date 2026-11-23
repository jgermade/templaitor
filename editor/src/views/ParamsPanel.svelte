<script>
  import Checkbox from '../components/Checkbox.svelte'
  import Icon from '../components/Icon.svelte'
  import ImageField from '../components/ImageField.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { PARAM_TYPES, toBoolean } from '@shared/imports.js'

  let newName = $state('')
  const TYPES = PARAM_TYPES
  const params = $derived(Object.entries(store.componentParams))
  const used = $derived(new Set([...(store.split.body || '').matchAll(/\$param\.([A-Za-z_][\w-]*)/g)].map(m => m[1])))
</script>

<p class="intro muted">
  Use them in the component as <code>$param.name</code> (in texts, buttons or attributes). Each instance
  can set them: <code>$import(_components/{store.doc.id}, name="…")</code>.
</p>

{#each params as [name, d] (name)}
  <div class="param">
    <div class="row">
      <code class:unused={!used.has(name)} title={used.has(name) ? '' : 'Not used by the component'}>$param.{name}</code>
      <select value={d.type} onchange={(e) => store.setParamDecl(name, 'type', e.currentTarget.value)} aria-label="Type">
        {#each TYPES as t}<option value={t}>{t}</option>{/each}
      </select>
      <button class="ghost x" title="Remove parameter" aria-label="Remove parameter {name}" onclick={() => store.removeParamDecl(name)}><Icon name="x" size={12} /></button>
    </div>
    <div class="grid">
      <label><span>Label</span><input value={d.label === name ? '' : d.label} placeholder={name} oninput={(e) => store.setParamDecl(name, 'label', e.currentTarget.value)} /></label>
      {#if d.type === 'boolean'}
        <label class="check"><span>Default</span>
          <Checkbox checked={!!toBoolean(d.default)} onchange={(e) => store.setParamDecl(name, 'default', e.currentTarget.checked)}>{toBoolean(d.default) ? 'yes' : 'no'}</Checkbox>
        </label>
      {:else if d.type === 'image'}
        <div class="full img"><span>Default</span>
          <ImageField value={d.default ?? ''} onchange={(v) => store.setParamDecl(name, 'default', v)} {...store.imageProps} />
        </div>
      {:else}
        <label><span>Default</span><input class="mono" value={d.default ?? ''} oninput={(e) => store.setParamDecl(name, 'default', e.currentTarget.value)} /></label>
      {/if}
      {#if d.type === 'boolean'}
        <p class="full tip">Use it to show or hide parts: <code>$if($param.{name}) … $end</code></p>
      {/if}
      {#if d.type === 'select'}
        <label class="full"><span>Options (comma separated)</span>
          <input class="mono" value={(d.options || []).join(', ')} onchange={(e) => store.setParamDecl(name, 'options', e.currentTarget.value.split(',').map(o => o.trim()).filter(Boolean))} />
        </label>
      {/if}
    </div>
  </div>
{:else}
  <p class="empty">No parameters.</p>
{/each}

<form class="add" onsubmit={(e) => { e.preventDefault(); if (newName.trim()) { store.addParamDecl(newName); newName = '' } }}>
  <input class="mono" placeholder="name" bind:value={newName} />
  <button type="submit" disabled={!newName.trim()}>Add parameter</button>
</form>

<style>
  .intro { margin: 0 14px 8px; font-size: 12px; }
  .param { margin: 0 14px 8px; padding: 8px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
  .row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .row code { flex: 1; color: #6d28d9; font-size: 12px; }
  .row code.unused { color: var(--muted); }
  .row select { font-size: 12px; padding: 1px 4px; }
  .x { color: var(--muted); padding: 0 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .grid label { display: grid; gap: 2px; font-size: 11px; color: var(--muted); }
  .grid .full { grid-column: 1 / -1; }
  .grid input { font-size: 12px; color: var(--text); }
  .img { display: grid; gap: 2px; font-size: 11px; color: var(--muted); }
  .check span:last-child { display: flex; align-items: center; gap: 6px; color: var(--text); font-size: 12px; height: 28px; }
  .tip { margin: 0; font-size: 11px; color: var(--muted); }
  .empty { color: var(--muted); font-size: 12px; margin: 0 14px 8px; }
  .add { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 0 14px; }
</style>
