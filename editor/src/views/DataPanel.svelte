<script>
  // Data contract of the template (`data:` in its frontmatter): the data the backend has to send.
  // Types, required and description per field; lists and objects have nested fields.
  import Icon from '../components/Icon.svelte'
  import Checkbox from '../components/Checkbox.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { DATA_TYPES, rulesSummary } from '@shared/contract.js'

  const ICON = { string: 'text', number: 'hash', boolean: 'toggle', date: 'calendar', url: 'link', email: 'email', list: 'list', object: 'variable' }
  const used = $derived(new Set(store.preview.usedVars || []))
  const undeclared = $derived([...used].filter(v => !store.contract[v]))
  // the type shown for a list is the type of its items
  const ofType = (f) => f.of?.type ?? 'string'

  // rules (enum / min / max / pattern) per type, and which fields have them open
  const RULES = {
    string: ['enum', 'len', 'pattern'], url: ['len', 'pattern'], email: ['len', 'pattern'],
    number: ['enum', 'range'], date: ['dates'], list: ['items'],
  }
  let open = $state(new Set())
  const toggle = (key) => { const n = new Set(open); n.has(key) ? n.delete(key) : n.add(key); open = n }
  const num = (v) => (String(v).trim() === '' ? undefined : Number(v))
  const list = (v) => { const a = String(v).split(',').map(x => x.trim()).filter(Boolean); return a.length ? a : undefined }
</script>

{#snippet fields(map, path, depth)}
  <ul class="fields" class:nested={depth > 0}>
    {#each Object.entries(map) as [name, f] (name)}
      {@const p = [...path, name]}
      {@const unused = depth === 0 && store.preview.usedVars && !used.has(name)}
      <li>
        <div class="row">
          <span class="ic" title={f.type}><Icon name={ICON[f.type] ?? 'text'} size={14} /></span>
          <input class="mono name" value={name} aria-label="Field name" onchange={(e) => store.renameField(p, e.currentTarget.value)} />
          <select class="type" value={f.type} aria-label={`Type of ${name}`} onchange={(e) => store.updateField(p, { type: e.currentTarget.value })}>
            {#each DATA_TYPES as t}<option value={t}>{t}</option>{/each}
          </select>
          {#if f.type === 'list'}
            <span class="of">of</span>
            <select class="type" value={ofType(f)} aria-label={`Type of the items of ${name}`}
              onchange={(e) => store.updateField(p, { of: e.currentTarget.value === 'object' ? { type: 'object', fields: f.of?.fields ?? {} } : { type: e.currentTarget.value } })}>
              {#each DATA_TYPES.filter(t => t !== 'list') as t}<option value={t}>{t === 'object' ? 'objects' : t}</option>{/each}
            </select>
          {/if}
          <button class="ghost x" aria-label={`Remove ${name}`} title="Remove" onclick={() => store.removeField(p)}><Icon name="x" size={12} /></button>
        </div>
        <div class="row sub">
          <Checkbox checked={f.required} onchange={(e) => store.updateField(p, { required: e.currentTarget.checked })} class="req">required</Checkbox>
          <input class="desc" value={f.description} placeholder="Description" aria-label={`Description of ${name}`}
            onchange={(e) => store.updateField(p, { description: e.currentTarget.value })} />
          {#if unused}<span class="unused" title="Declared but not used by the template">not used</span>{/if}
          {#if RULES[f.type]}
            {@const sum = rulesSummary(f)}
            <button class="ghost rules" class:on={!!sum} aria-expanded={open.has(p.join('.'))} aria-label={`Rules of ${name}${sum ? `: ${sum}` : ''}`}
              title="Allowed values, limits and pattern" onclick={() => toggle(p.join('.'))}>{sum || 'Rules'}</button>
          {/if}
        </div>
        {#if RULES[f.type] && open.has(p.join('.'))}
          {@const R = RULES[f.type]}
          <div class="rulebox">
            {#if R.includes('enum')}
              <label><span>Allowed values</span>
                <input class="mono" value={(f.enum || []).join(', ')} placeholder="a, b, c (any value when empty)"
                  onchange={(e) => store.updateField(p, { enum: list(e.currentTarget.value)?.map(v => (f.type === 'number' ? Number(v) : v)) })} /></label>
            {/if}
            {#if R.includes('len') || R.includes('range') || R.includes('items')}
              {@const what = R.includes('len') ? 'length' : R.includes('items') ? 'items' : 'value'}
              <div class="pair">
                <label><span>Min {what}</span><input type="number" value={f.min ?? ''} onchange={(e) => store.updateField(p, { min: num(e.currentTarget.value) })} /></label>
                <label><span>Max {what}</span><input type="number" value={f.max ?? ''} onchange={(e) => store.updateField(p, { max: num(e.currentTarget.value) })} /></label>
              </div>
            {/if}
            {#if R.includes('dates')}
              <div class="pair">
                <label><span>From</span><input type="date" value={f.min ?? ''} onchange={(e) => store.updateField(p, { min: e.currentTarget.value || undefined })} /></label>
                <label><span>Until</span><input type="date" value={f.max ?? ''} onchange={(e) => store.updateField(p, { max: e.currentTarget.value || undefined })} /></label>
              </div>
            {/if}
            {#if R.includes('pattern')}
              <label><span>Pattern (regular expression)</span>
                <input class="mono" value={f.pattern ?? ''} placeholder="e.g. ^[A-Z]{'{'}2{'}'}-\d+$"
                  onchange={(e) => store.updateField(p, { pattern: e.currentTarget.value || undefined })} /></label>
            {/if}
          </div>
        {/if}
        {#if f.type === 'object'}
          {@render fields(f.fields ?? {}, p, depth + 1)}
        {:else if f.type === 'list' && ofType(f) === 'object'}
          {@render fields(f.of.fields ?? {}, p, depth + 1)}
        {/if}
      </li>
    {/each}
    <li><button class="ghost add" onclick={() => store.addField(path)}><Icon name="plus" size={12} /> Add field</button></li>
  </ul>
{/snippet}

<div class="data">
  {#if !store.hasContract}
    <p class="muted">This template declares no data contract: the backend may send anything.</p>
    <div class="btns">
      <button class="primary" onclick={() => store.generateContract()}>Generate from demo data</button>
      <button onclick={() => store.setContract({})}>Start empty</button>
    </div>
  {:else}
    <p class="hint muted">What the backend sends in <code>data</code>: checked by <code>/v1/send</code> and the library; the demo data must fulfil it.</p>
    {#if undeclared.length}
      <div class="undeclared" role="status">
        <span>Used but not declared:</span>
        {#each undeclared as v}<button class="chip" onclick={() => store.addField([], v)} title="Declare {v}"><Icon name="plus" size={11} /> {v}</button>{/each}
      </div>
    {/if}
    {@render fields(store.contract, [], 0)}
    <button class="ghost small" onclick={() => store.generateContract()} title="Adds the fields of the demo data and the variables the template uses that are missing">Complete from demo data</button>
  {/if}
</div>

<style>
  .data { padding: 0 14px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .hint { font-size: 12px; margin: 0 0 8px; }
  .data .muted { color: #52525b; } /* 4.5:1 on the sidebar grey */
  .fields { list-style: none; margin: 0; padding: 0; }
  .fields.nested { margin: 4px 0 4px 10px; padding-left: 10px; border-left: 2px solid var(--border); }
  .fields > li { padding: 4px 0; }
  .row { display: flex; align-items: center; gap: 4px; }
  .row.sub { margin: 3px 0 0 22px; }
  .ic { display: inline-grid; color: #52525b; width: 18px; place-content: center; }
  .name { flex: 1; min-width: 0; font-size: 12px; padding: 3px 6px; font-weight: 600; }
  .type { font-size: 12px; padding: 2px 4px; max-width: 92px; }
  .of { font-size: 11px; color: #52525b; }
  .desc { flex: 1; min-width: 0; font-size: 12px; padding: 2px 6px; }
  .row.sub :global(.req) { font-size: 11px; color: #3f3f46; }
  .x { padding: 2px 4px; }
  .unused { font-size: 10.5px; color: #92400e; background: #fef3c7; border-radius: 999px; padding: 0 6px; white-space: nowrap; }
  .add { font-size: 12px; color: var(--accent); padding: 2px 4px; }
  .rules { flex: none; font: 600 10.5px var(--mono); padding: 1px 7px; border-radius: 999px; color: #52525b; border: 1px dashed #a1a1aa; }
  .rules.on { color: #3730a3; background: var(--accent-soft); border: 1px solid #c7d2fe; }
  .rulebox { margin: 6px 0 2px 22px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: #fff; display: grid; gap: 6px; }
  .rulebox label { display: grid; gap: 2px; font-size: 11px; color: #52525b; }
  .rulebox input { font-size: 12px; padding: 3px 6px; min-width: 0; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .small { font-size: 12px; margin-top: 6px; }
  .undeclared { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius); padding: 6px 8px; margin-bottom: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 3px; font: 600 11px var(--mono); padding: 1px 6px; border-radius: 999px; }
</style>
