<script>
  import AttrField from '../components/AttrField.svelte'
  import TemplateSettings from './TemplateSettings.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { describe } from '@shared/components.js'
  import { findNode, getAttr } from '@shared/mjml-tree.js'

  const node = $derived(store.selected)
  const def = $derived(node?.type === 'element' ? describe(node.tag) : null)
  const key = $derived(store.keyOf(node))
  const knownNames = $derived(new Set((def?.attrs || []).map(a => a.name)))
  const extraAttrs = $derived((node?.attrs || []).filter(([k]) => !knownNames.has(k)))

  const crumbs = $derived.by(() => {
    if (store.selectedId == null) return []
    const parts = String(store.selectedId).split('.')
    return parts.map((_, i) => {
      const id = parts.slice(0, i + 1).join('.')
      const n = findNode(store.tree, id)
      return { id, label: n?.tag ? describe(n.tag).label : 'Código' }
    })
  })

  // variables disponibles: claves de los datos de demo (hasta 2 niveles) + links
  const variables = $derived.by(() => {
    const out = []
    const walk = (obj, prefix, depth) => {
      for (const [k, v] of Object.entries(obj || {})) {
        const name = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) walk(v, name, depth + 1)
        else if (!Array.isArray(v)) out.push(name)
      }
    }
    walk(store.demoData, '', 0)
    return out
  })
  const links = $derived(Object.keys(store.project?.links || {}))

  let newAttr = $state('')
  let renaming = $state(null)
</script>

<aside>
  {#if !node}
    <TemplateSettings />
  {:else}
    <div class="head">
      <nav class="crumbs">
        <button class="ghost" onclick={() => (store.selectedId = null)}>Plantilla</button>
        {#each crumbs as c}
          <span class="muted">›</span>
          <button class="ghost" class:cur={c.id === store.selectedId} onclick={() => (store.selectedId = c.id)}>{c.label}</button>
        {/each}
      </nav>
      <div class="title">
        <span class="ic">{def?.icon ?? '$'}</span>
        <b>{def?.label ?? 'Código'}</b>
        {#if node.tag}<code class="muted">&lt;{node.tag}&gt;</code>{/if}
        <span class="grow"></span>
        {#if node.tag !== 'mjml' && node.tag !== 'mj-body'}
          <button class="ghost" title="Duplicar" onclick={() => store.duplicate(node.id)}>⧉</button>
          <button class="ghost danger" title="Eliminar (Supr)" onclick={() => store.removeSelected()}>✕</button>
        {/if}
      </div>
    </div>

    <div class="body">
      {#if node.type === 'text'}
        <label class="field">
          <span>Código (comandos $, bloques Jinja2…)</span>
          <textarea class="mono" rows="6" value={node.value} oninput={(e) => store.mutate(t => { findNode(t, node.id).value = e.currentTarget.value }, `text:${node.id}`)}></textarea>
        </label>
      {:else if node.content != null}
        <section>
          <div class="panel-title">Contenido</div>
          {#if key}
            <div class="keyrow">
              <span class="muted">Traducción</span>
              {#if renaming !== null}
                <input class="mono" bind:value={renaming} onkeydown={(e) => { if (e.key === 'Enter') { store.renameKey(key, renaming.trim()); renaming = null } if (e.key === 'Escape') renaming = null }} onblur={() => { store.renameKey(key, renaming.trim()); renaming = null }} />
              {:else}
                <button class="chip" title="Renombrar clave" onclick={() => (renaming = key)}>$t('{key}')</button>
              {/if}
            </div>
            {#each store.langs as l}
              {@const msg = store.i18n.messages?.[l]?.[key]}
              <label class="field">
                <span class="mono" class:missing={msg == null}>{l}{msg == null ? ' · sin traducción' : ''}</span>
                <textarea rows="3" value={msg == null ? '' : String(msg).trim()} oninput={(e) => store.setMessage(l, key, e.currentTarget.value)}></textarea>
              </label>
            {/each}
            <button class="ghost small" onclick={() => store.inlineTranslation(node.id)}>Convertir en texto literal</button>
          {:else}
            <label class="field">
              <span>{def?.editable ? 'HTML (también editable en el lienzo)' : 'HTML / Jinja2'}</span>
              <textarea class="mono" rows={def?.editable ? 4 : 10} value={node.content} oninput={(e) => store.setContent(node.id, e.currentTarget.value)}></textarea>
            </label>
            {#if def?.editable}
              <button class="ghost small" onclick={() => store.makeTranslatable(node.id)}>🌐 Hacer traducible ($t)</button>
            {/if}
          {/if}

          {#if variables.length || links.length}
            <div class="vars">
              <span class="muted">Insertar {store.editing ? 'en el cursor' : 'al final'}:</span>
              {#each variables as v}
                <button class="chip" onmousedown={(e) => e.preventDefault()} onclick={() => store.insertToken(`{{ ${v} }}`)}>{v}</button>
              {/each}
              {#each links as l}
                <button class="chip link" onmousedown={(e) => e.preventDefault()} onclick={() => store.insertToken(`$link{ ${l}, label: ${l} }`)}>🔗 {l}</button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if node.type === 'element'}
        <section>
          <div class="panel-title">Atributos</div>
          {#each def.attrs as a (a.name)}
            <AttrField def={a} value={getAttr(node, a.name)} onchange={(v) => store.setAttr(node.id, a.name, v)} />
          {/each}
          {#each extraAttrs as [k, v] (k)}
            <div class="extra">
              <input class="mono" value={k} onchange={(e) => store.renameAttr(node.id, k, e.currentTarget.value.trim())} />
              <input class="mono" value={v} oninput={(e) => store.setAttr(node.id, k, e.currentTarget.value)} />
              <button class="ghost" title="Quitar" onclick={() => store.setAttr(node.id, k, null)}>✕</button>
            </div>
          {/each}
          <form class="extra" onsubmit={(e) => { e.preventDefault(); if (newAttr.trim()) { store.setAttr(node.id, newAttr.trim(), ' '); newAttr = '' } }}>
            <input class="mono" placeholder="nuevo-atributo" bind:value={newAttr} />
            <button type="submit">Añadir</button>
          </form>
          <p class="hint muted">Los valores admiten <code>{'{{ variables }}'}</code> Jinja2 y comandos <code>$t</code> / <code>$link</code>.</p>
        </section>
      {/if}
    </div>
  {/if}
</aside>

<style>
  aside { background: var(--panel); border-left: 1px solid var(--border); overflow: auto; min-height: 0; }
  .head { position: sticky; top: 0; background: var(--panel); border-bottom: 1px solid var(--border); padding: 6px 8px 8px; z-index: 1; }
  .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 0; font-size: 11px; }
  .crumbs button { padding: 1px 4px; font-size: 11px; color: var(--muted); }
  .crumbs button.cur { color: var(--text); font-weight: 600; }
  .title { display: flex; align-items: center; gap: 6px; padding: 4px 4px 0; font-size: 14px; }
  .title code { font-size: 11px; }
  .ic { color: var(--muted); width: 18px; text-align: center; }
  .grow { flex: 1; }
  .body { padding: 0 12px 24px; }
  section { border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 4px; }
  section .panel-title { padding-left: 0; }
  .keyrow { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .missing { color: var(--danger); }
  .small { font-size: 12px; padding: 2px 6px; }
  .vars { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; align-items: center; font-size: 11px; }
  .extra { display: grid; grid-template-columns: 1fr 1fr auto; gap: 4px; margin-bottom: 6px; }
  .hint { font-size: 11px; margin: 6px 0 0; }
</style>
