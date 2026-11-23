<script>
  import Icon from '../components/Icon.svelte'
  import AttrField from '../components/AttrField.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { describe } from '@shared/components.js'
  import { findNode, getAttr } from '@shared/mjml-tree.js'
  import { headingLevel } from '@shared/semantics.js'

  const node = $derived(store.selected)
  const instance = $derived(store.instanceOf(node))
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
      return { id, label: n?.tag ? describe(n.tag).label : store.instanceOf(n)?.name ?? 'Code' }
    })
  })

  // available variables: demo data keys (up to 2 levels) + links
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
  {#if node}
    <div class="head">
      <nav class="crumbs">
        <button class="ghost" onclick={() => (store.selectedId = null)}>{store.isComponent ? 'Component' : store.isLayout ? 'Layout' : 'Template'}</button>
        {#each crumbs as c}
          <Icon name="chevron-right" size={11} class="sep" />
          <button class="ghost" class:cur={c.id === store.selectedId} onclick={() => (store.selectedId = c.id)}>{c.label}</button>
        {/each}
      </nav>
      <div class="title">
        <span class="ic" class:comp={instance}><Icon name={def?.icon ?? (instance ? 'component' : 'variable')} size={14} /></span>
        <b>{def?.label ?? (instance ? instance.name : 'Code')}</b>
        {#if node.tag}<code class="muted">&lt;{node.tag}&gt;</code>{/if}
        <span class="grow"></span>
        {#if node.tag !== 'mjml' && node.tag !== 'mj-body'}
          <button class="ghost" title="Duplicate" aria-label="Duplicate" onclick={() => store.duplicate(node.id)}><Icon name="copy" size={15} /></button>
          <button class="ghost danger" title="Delete (Del)" aria-label="Delete" onclick={() => store.removeSelected()}><Icon name="trash" size={15} /></button>
        {/if}
        <button class="ghost" title="Close (Esc)" aria-label="Close" onclick={() => (store.selectedId = null)}><Icon name="x" size={15} /></button>
      </div>
    </div>

    <div class="body">
      {#if instance}
        <section class="comp">
          <div class="panel-title">Reusable component</div>
          {#if instance.comp}
            <p>This block is an instance of <b><Icon name="component" size={10} /> {instance.comp.name}</b>, used in {instance.comp.usedBy.length} place(s). Changes to the component apply everywhere.</p>
            {@const decl = instance.comp.params}
            {@const given = Object.fromEntries(instance.params)}
            {#if Object.keys(decl).length || instance.params.length}
              <div class="panel-title">Parameters</div>
              {#each Object.entries(decl) as [name, d] (name)}
                <AttrField
                  def={{ name, label: d.label, type: d.type, options: ['', ...(d.options || [])] }}
                  value={given[name] ?? ''}
                  placeholder={String(d.default ?? '')}
                  image={store.imageProps}
                  onchange={(v) => store.setParam(node.id, name, v)}
                />
              {/each}
              {#each instance.params.filter(([k]) => !decl[k]) as [k, v] (k)}
                <div class="extra">
                  <input class="mono" value={k} disabled title="Parameter not declared by the component" />
                  <input class="mono" value={v} oninput={(e) => store.setParam(node.id, k, e.currentTarget.value)} />
                  <button class="ghost" title="Remove" aria-label="Remove {k}" onclick={() => store.setParam(node.id, k, '')}><Icon name="x" size={13} /></button>
                </div>
              {/each}
              <p class="hint muted">Empty = the component default. Values accept <code>{'{{ variables }}'}</code> and <code>$t('key')</code>.</p>
            {/if}
            <div class="btns">
              <button class="primary" onclick={() => store.openComponent(instance.comp.id)}><Icon name="pencil" size={14} /> Edit component</button>
              <button onclick={() => store.detach(node.id)} title="Replaces the instance with a copy editable only in this template">Detach (copy here)</button>
            </div>
          {:else}
            <p class="muted">Imported partial: <code>{instance.ref}</code>. Edit it in the Code view.</p>
          {/if}
        </section>
      {:else if node.type === 'text' && node.value.trim() === '$content'}
        <section>
          <div class="panel-title">Template content</div>
          <p class="muted slotp">Every template using this layout is inserted here. Move it in "Structure" to change where it goes; do not delete it (the layout must contain <code>$content</code>).</p>
        </section>
      {:else if node.type === 'text'}
        <label class="field">
          <span>Code ($ commands, Jinja2 blocks…)</span>
          <textarea class="mono" rows="6" value={node.value} oninput={(e) => store.mutate(t => { findNode(t, node.id).value = e.currentTarget.value }, `text:${node.id}`)}></textarea>
        </label>
      {:else if node.content != null}
        <section>
          <div class="panel-title">Content</div>
          {#if node.tag === 'mj-text'}
            {@const level = headingLevel(node.content)}
            <label class="field">
              <span>Semantics (accessibility)</span>
              <select value={String(level)} onchange={(e) => store.setHeading(node.id, Number(e.currentTarget.value))}>
                <option value="0">Paragraph</option>
                <option value="1">Heading 1 (main)</option>
                <option value="2">Heading 2</option>
                <option value="3">Heading 3</option>
              </select>
            </label>
          {/if}
          {#if key}
            <div class="keyrow">
              <span class="muted">Translation</span>
              {#if renaming !== null}
                <input class="mono" bind:value={renaming} onkeydown={(e) => { if (e.key === 'Enter') { store.renameKey(key, renaming.trim()); renaming = null } if (e.key === 'Escape') renaming = null }} onblur={() => { store.renameKey(key, renaming.trim()); renaming = null }} />
              {:else}
                <button class="chip" title="Rename key" onclick={() => (renaming = key)}>$t('{key}')</button>
              {/if}
            </div>
            {#each store.langs as l}
              {@const msg = store.i18n.messages?.[l]?.[key]}
              <label class="field">
                <span class="mono" class:missing={msg == null}>{l}{msg == null ? ' · missing translation' : ''}</span>
                <textarea rows="3" value={msg == null ? '' : String(msg).trim()} oninput={(e) => store.setMessage(l, key, e.currentTarget.value)}></textarea>
              </label>
            {/each}
            <button class="ghost small" onclick={() => store.inlineTranslation(node.id)}>Convert to literal text</button>
          {:else}
            <label class="field">
              <span>{def?.editable ? 'HTML (also editable on the canvas)' : 'HTML / Jinja2'}</span>
              <textarea class="mono" rows={def?.editable ? 4 : 10} value={node.content} oninput={(e) => store.setContent(node.id, e.currentTarget.value)}></textarea>
            </label>
            {#if def?.editable}
              <button class="ghost small" onclick={() => store.makeTranslatable(node.id)}><Icon name="globe" size={13} /> Make translatable ($t)</button>
            {/if}
          {/if}

          {#if variables.length || links.length || (store.isComponent && Object.keys(store.componentParams).length)}
            <div class="vars">
              <span class="muted">Insert {store.editing ? 'at the cursor' : 'at the end'}:</span>
              {#each variables as v}
                <button class="chip" onmousedown={(e) => e.preventDefault()} onclick={() => store.insertToken(`{{ ${v} }}`)}>{v}</button>
              {/each}
              {#if store.isComponent}
                {#each Object.keys(store.componentParams) as pname}
                  <button class="chip param" onmousedown={(e) => e.preventDefault()} onclick={() => store.insertToken(`$param.${pname}`)}><Icon name="settings" size={12} /> {pname}</button>
                {/each}
              {/if}
              {#each links as l}
                <button class="chip link" onmousedown={(e) => e.preventDefault()} onclick={() => store.insertToken(`$link{ ${l}, label: ${l} }`)}><Icon name="link" size={12} /> {l}</button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if node.type === 'element'}
        <section>
          <div class="panel-title">Attributes</div>
          {#each def.attrs as a (a.name)}
            <AttrField def={a} value={getAttr(node, a.name)} image={store.imageProps} onchange={(v) => store.setAttr(node.id, a.name, v)} />
          {/each}
          {#each extraAttrs as [k, v] (k)}
            <div class="extra">
              <input class="mono" value={k} onchange={(e) => store.renameAttr(node.id, k, e.currentTarget.value.trim())} />
              <input class="mono" value={v} oninput={(e) => store.setAttr(node.id, k, e.currentTarget.value)} />
              <button class="ghost" title="Remove" aria-label="Remove {k}" onclick={() => store.setAttr(node.id, k, null)}><Icon name="x" size={13} /></button>
            </div>
          {/each}
          <form class="extra" onsubmit={(e) => { e.preventDefault(); if (newAttr.trim()) { store.setAttr(node.id, newAttr.trim(), ' '); newAttr = '' } }}>
            <input class="mono" placeholder="new-attribute" bind:value={newAttr} />
            <button type="submit">Add</button>
          </form>
          <p class="hint muted">Values accept Jinja2 <code>{'{{ variables }}'}</code> and <code>$t</code> / <code>$link</code> commands{store.isComponent ? ' / $param.name' : ''}.</p>
        </section>
      {/if}
    </div>
  {/if}
</aside>

<style>
  aside { background: var(--panel); border-left: 1px solid var(--border); overflow: auto; min-height: 0; }
  .comp p { margin: 0 0 10px; font-size: 12.5px; }
  .slotp { font-size: 12.5px; margin: 0 0 10px; }
  .btns { display: grid; gap: 6px; margin-top: 10px; }
  .comp .panel-title { padding-left: 0; }
  .chip.param { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
  .ic.comp { color: #7c3aed; font-size: 12px; }
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
