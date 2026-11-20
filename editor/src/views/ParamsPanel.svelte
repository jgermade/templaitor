<script>
  import { store } from '../stores/editor.svelte.js'

  let newName = $state('')
  const TYPES = ['text', 'color', 'select']
  const params = $derived(Object.entries(store.componentParams))
  const used = $derived(new Set([...(store.split.body || '').matchAll(/\$param\.([A-Za-z_][\w-]*)/g)].map(m => m[1])))
</script>

<p class="intro muted">
  Úsalos en el componente como <code>$param.nombre</code> (en textos, botones o atributos). Cada instancia
  puede darles valor: <code>$import(_components/{store.doc.id}, nombre="…")</code>.
</p>

{#each params as [name, d] (name)}
  <div class="param">
    <div class="row">
      <code class:unused={!used.has(name)} title={used.has(name) ? '' : 'No se usa en el componente'}>$param.{name}</code>
      <select value={d.type} onchange={(e) => store.setParamDecl(name, 'type', e.currentTarget.value)} aria-label="Tipo">
        {#each TYPES as t}<option value={t}>{t}</option>{/each}
      </select>
      <button class="ghost x" title="Eliminar parámetro" onclick={() => store.removeParamDecl(name)}>✕</button>
    </div>
    <div class="grid">
      <label><span>Etiqueta</span><input value={d.label === name ? '' : d.label} placeholder={name} oninput={(e) => store.setParamDecl(name, 'label', e.currentTarget.value)} /></label>
      <label><span>Por defecto</span><input class="mono" value={d.default ?? ''} oninput={(e) => store.setParamDecl(name, 'default', e.currentTarget.value)} /></label>
      {#if d.type === 'select'}
        <label class="full"><span>Opciones (separadas por comas)</span>
          <input class="mono" value={(d.options || []).join(', ')} onchange={(e) => store.setParamDecl(name, 'options', e.currentTarget.value.split(',').map(o => o.trim()).filter(Boolean))} />
        </label>
      {/if}
    </div>
  </div>
{:else}
  <p class="empty">Sin parámetros.</p>
{/each}

<form class="add" onsubmit={(e) => { e.preventDefault(); if (newName.trim()) { store.addParamDecl(newName); newName = '' } }}>
  <input class="mono" placeholder="nombre" bind:value={newName} />
  <button type="submit" disabled={!newName.trim()}>Añadir parámetro</button>
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
  .empty { color: var(--muted); font-size: 12px; margin: 0 14px 8px; }
  .add { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 0 14px; }
</style>
