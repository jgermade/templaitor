<script>
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'

  let { open = $bindable(false), onnew } = $props()
  let filter = $state('')
  let input = $state()

  $effect(() => { if (open) queueMicrotask(() => input?.focus()) })

  const match = (t) => !filter || t.id.toLowerCase().includes(filter.toLowerCase())
  const groups = $derived.by(() => {
    const g = {}
    for (const t of store.templates.filter(match)) (g[t.group || '—'] ??= []).push(t)
    return Object.entries(g)
  })
  const comps = $derived(store.components.filter(match))

  async function pick(id, kind) {
    open = false
    filter = ''
    if (kind === 'component') store.returnTo = null
    await store.open(id, kind)
  }

  async function newComponent() {
    const id = prompt('Nombre del componente (p.ej. header, legal-notice):')
    if (!id) return
    try {
      const c = await api.createComponent({ id: id.trim() })
      await store.refreshTemplates()
      await pick(c.id, 'component')
    } catch (e) { store.notify(e.message, 'error') }
  }
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false }} />

{#if open}
  <div class="backdrop" role="none" onclick={() => (open = false)}></div>
  <div class="picker" role="dialog" aria-label="Abrir plantilla o componente">
    <input bind:this={input} bind:value={filter} placeholder="Buscar…" onkeydown={(e) => {
      if (e.key === 'Enter') { const t = groups[0]?.[1][0]; if (t) pick(t.id, 'template'); else if (comps[0]) pick(comps[0].id, 'component') }
    }} />
    <div class="list">
      <div class="head">Plantillas</div>
      {#each groups as [group, items]}
        {#each items as t}
          <button class="item" class:cur={store.kind === 'template' && store.doc?.id === t.id} onclick={() => pick(t.id, 'template')}>
            <span class="muted">{group === '—' ? '' : `${group}/`}</span>{t.name}
            <span class="langs">{t.langs.join(' · ')}</span>
          </button>
        {/each}
      {/each}
      <button class="item add" onclick={() => { open = false; onnew?.() }}>＋ Nueva plantilla</button>

      <div class="head">Componentes</div>
      {#each comps as c}
        <button class="item" class:cur={store.kind === 'component' && store.doc?.id === c.id} onclick={() => pick(c.id, 'component')}>
          <span class="diamond">◆</span>{c.name}
          <span class="langs">{c.usedBy.length} uso(s)</span>
        </button>
      {/each}
      <button class="item add" onclick={newComponent}>＋ Nuevo componente</button>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 40; }
  .picker {
    position: absolute; top: 40px; left: 0; z-index: 41; width: 420px; max-width: calc(100vw - 24px);
    background: #fff; border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.18);
    padding: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 70vh;
  }
  input { width: 100%; }
  .list { overflow: auto; }
  .head { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); padding: 8px 8px 4px; }
  .item { display: flex; align-items: center; gap: 2px; width: 100%; border: 0; text-align: left; padding: 6px 8px; border-radius: 6px; background: transparent; }
  .item:hover { background: #f4f4f5; }
  .item.cur { background: var(--accent-soft); }
  .item.add { color: var(--accent); }
  .langs { margin-left: auto; font-size: 11px; color: var(--muted); font-family: var(--mono); }
  .diamond { color: #7c3aed; margin-right: 6px; font-size: 11px; }
</style>
