<script>
  // Compare mode: base (A) ↔ current draft (B). Visual diff (side by side, overlay, difference, swipe)
  // and code diff (MJML, texts, data, rendered text, compiled HTML) with chunk revert into the draft.
  import { untrack } from 'svelte'
  import { Chunk } from '@codemirror/merge'
  import { Text } from '@codemirror/state'
  import { store } from '../stores/editor.svelte.js'
  import { compare } from '../stores/compare.svelte.js'
  import { api } from '../lib/api.js'
  import { flagOf } from '../lib/flags.js'
  import DiffEditor from '../components/DiffEditor.svelte'

  let pA = $state(null) // previews (rendered with data)
  let pB = $state(null)
  let rA = $state(null) // raw compiled output (Jinja2 kept)
  let rB = $state(null)
  let errA = $state('')
  let errB = $state('')
  let hA = $state(0)
  let hB = $state(0)
  let busy = $state(false)

  // new document → reset and pick the default base
  $effect(() => {
    void store.kind; void store.doc?.id
    untrack(() => compare.prepare())
  })

  // previews of both sides (debounced)
  let seq = 0
  $effect(() => {
    const base = compare.base
    if (!base || !store.doc) return
    const A = { kind: base.kind ?? store.kind, mjml: base.mjml, yml: base.yml, data: compare.sameData ? store.doc.data : base.data, lang: compare.effectiveLangA }
    const B = { kind: store.kind, mjml: store.doc.mjml, yml: store.doc.yml, data: store.doc.data, lang: store.lang }
    const n = ++seq
    const t = setTimeout(async () => {
      busy = true
      const run = (d, mode) => api.preview({ ...d, mode }).then(r => ({ r }), e => ({ e: e.message }))
      const [a, b, ra, rb] = await Promise.all([run(A, 'preview'), run(B, 'preview'), run(A, 'raw'), run(B, 'raw')])
      if (n !== seq) return
      pA = a.r ?? null; errA = a.e ?? ''
      pB = b.r ?? null; errB = b.e ?? ''
      rA = ra.r ?? null; rB = rb.r ?? null
      busy = false
    }, 250)
    return () => clearTimeout(t)
  })

  const canEdit = $derived(!store.isLayout)
  const CODE_TABS = $derived([
    ['mjml', 'MJML', compare.base?.mjml ?? '', store.doc?.mjml ?? '', 'xml', true],
    ...(store.isLayout ? [] : [
      ['yml', 'Texts', compare.base?.yml ?? '', store.doc?.yml ?? '', 'yaml', true],
      ['data', 'Demo data', compare.base?.data ?? '', store.doc?.data ?? '', 'json5', true],
    ]),
    ['text', 'Rendered text', pA?.text ?? '', pB?.text ?? '', 'text', false],
    ['html', 'Compiled HTML', rA?.html ?? '', rB?.html ?? '', 'html', false],
  ])
  // changed blocks of lines (what the code diff highlights)
  const chunks = (a, b) => (a === b ? 0 : Chunk.build(Text.of(a.split('\n')), Text.of(b.split('\n')), { scanLimit: 2000 }).length)
  const counts = $derived(Object.fromEntries(CODE_TABS.map(([k, , a, b]) => [k, chunks(a, b)])))
  const current = $derived(CODE_TABS.find(t => t[0] === compare.codeTab) ?? CODE_TABS[0])
  const identical = $derived(!!pA && !!pB && CODE_TABS.every(([k]) => counts[k] === 0) && pA.subject === pB.subject)

  const a11y = (p) => {
    const checks = p?.a11yReport?.checks ?? []
    return { fail: checks.filter(c => c.status === 'fail').length, warn: checks.filter(c => c.status === 'warn').length }
  }
  const kb = (s) => `${(new Blob([s ?? '']).size / 1024).toFixed(1)} KB`
  const locale = (l) => store.project?.locales?.[l] || l
  const sameLang = $derived(locale(compare.effectiveLangA) === locale(store.lang))

  function fit(e, side) {
    const f = e.currentTarget
    try {
      const h = f.contentDocument.documentElement.scrollHeight
      f.style.height = `${h}px`
      if (side === 'A') hA = h; else hB = h
    } catch {}
  }

  function onchange(field, text) {
    if (store.doc?.[field] !== text) store.update({ [field]: text }, `compare:${field}`)
  }

  const date = (iso) => new Date(iso).toLocaleString()
  const otherDocs = $derived(store.isComponent
    ? store.components.filter(c => c.id !== store.doc?.id).map(c => ['component', c.id])
    : store.isLayout ? store.layouts.filter(l => l.id !== store.doc?.id).map(l => ['layout', l.id])
      : store.templates.filter(t => t.id !== store.doc?.id).map(t => ['template', t.id]))
  const width = $derived(store.device === 'mobile' ? 375 : null)
</script>

<section class="compare" aria-label="Compare">
  <div class="bar">
    <label class="src">
      <span>Compare</span>
      <select value={compare.source} onchange={(e) => compare.setSource(e.currentTarget.value)} disabled={compare.loading}>
        <option value="saved">Saved version{store.dirty ? ' (unsaved changes)' : ''}</option>
        {#if compare.history.commits.length}
          <optgroup label="Git history">
            {#each compare.history.commits as c}
              <option value={`git:${c.rev}`}>{c.short} · {c.subject.slice(0, 60)} · {date(c.date)}</option>
            {/each}
          </optgroup>
        {/if}
        {#if otherDocs.length}
          <optgroup label={store.isComponent ? 'Other components' : store.isLayout ? 'Other layouts' : 'Other templates'}>
            {#each otherDocs as [kind, id]}<option value={`doc:${kind}:${id}`}>{id}</option>{/each}
          </optgroup>
        {/if}
      </select>
      <span class="muted">with the current draft</span>
    </label>

    <div class="langs" role="group" aria-label="Languages">
      <label><span class="tag a">A</span>
        <select aria-label="Language of A" value={compare.effectiveLangA} onchange={(e) => (compare.langA = e.currentTarget.value)}>
          {#each compare.langsA as l}<option value={l}>{flagOf(locale(l)) ?? ''} {locale(l)}</option>{/each}
        </select>
      </label>
      <span aria-hidden="true">↔</span>
      <label><span class="tag b">B</span>
        <select aria-label="Language of B (current draft)" value={store.lang} onchange={(e) => (store.lang = e.currentTarget.value)}>
          {#each store.langs as l}<option value={l}>{flagOf(locale(l)) ?? ''} {locale(l)}</option>{/each}
        </select>
      </label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={compare.sameData} /> Same demo data</label>

    <span class="grow"></span>
    {#if busy || compare.loading}<span class="spinner" aria-label="Updating"></span>{/if}
    <div class="seg" role="group" aria-label="Comparison">
      <button class:active={compare.tab === 'visual'} aria-pressed={compare.tab === 'visual'} onclick={() => (compare.tab = 'visual')}>Visual</button>
      <button class:active={compare.tab === 'code'} aria-pressed={compare.tab === 'code'} onclick={() => (compare.tab = 'code')}>Code</button>
    </div>
  </div>

  {#if compare.error}<p class="error" role="alert">{compare.error}</p>{/if}

  <!-- summary -->
  {#if pA && pB}
    {@const xa = a11y(pA)}
    {@const xb = a11y(pB)}
    <dl class="summary" aria-label="Summary of differences">
      <div class:changed={pA.subject !== pB.subject}>
        <dt>{store.isPdf ? 'Title' : 'Subject'}</dt>
        <dd>{#if pA.subject === pB.subject}{pB.subject || '—'}{:else}<del>{pA.subject || '—'}</del> → <ins>{pB.subject || '—'}</ins>{/if}</dd>
      </div>
      <div class:changed={xa.fail !== xb.fail || xa.warn !== xb.warn}>
        <dt>Accessibility</dt>
        <dd><span class:bad={xa.fail}>A {xa.fail} ✕ {xa.warn} ⚠</span> · <span class:bad={xb.fail}>B {xb.fail} ✕ {xb.warn} ⚠</span></dd>
      </div>
      <div>
        <dt>HTML size</dt>
        <dd>{kb(rA?.html)} → {kb(rB?.html)}</dd>
      </div>
      {#if (pA.attachments?.length || pB.attachments?.length)}
        <div class:changed={JSON.stringify(pA.attachments?.map(a => a.filename)) !== JSON.stringify(pB.attachments?.map(a => a.filename))}>
          <dt>Attachments</dt>
          <dd>{pA.attachments?.map(a => a.filename).join(', ') || '—'} → {pB.attachments?.map(a => a.filename).join(', ') || '—'}</dd>
        </div>
      {/if}
    </dl>
    <p class="verdict" role="status">{#if identical}<span class="same">✓ No differences{sameLang ? '' : ' (other than the language)'}</span>{:else}{Object.values(counts).reduce((x, y) => x + y, 0)} changed block(s) in the sources and output{/if}</p>
  {/if}

  {#if compare.tab === 'visual'}
    <div class="vbar">
      <div class="seg" role="group" aria-label="Visual comparison mode">
        {#each [['side', 'Side by side'], ['overlay', 'Overlay'], ['difference', 'Difference'], ['swipe', 'Swipe']] as [m, label]}
          <button class:active={compare.visual === m} aria-pressed={compare.visual === m} onclick={() => (compare.visual = m)}>{label}</button>
        {/each}
      </div>
      {#if compare.visual === 'overlay' || compare.visual === 'swipe'}
        <label class="range">
          <span>{compare.visual === 'overlay' ? 'Opacity of B' : 'Position'}</span>
          <input type="range" min="0" max="100" bind:value={compare.amount} />
          <span class="mono">{compare.amount}%</span>
        </label>
      {:else if compare.visual === 'difference'}
        <span class="muted hint">Identical pixels are black; what changed shows in color.</span>
      {/if}
    </div>

    <div class="stage-wrap" tabindex="0" role="region" aria-label="Visual comparison">
      {#if errA || errB}<p class="error" role="alert">{errA ? `A: ${errA}` : ''} {errB ? `B: ${errB}` : ''}</p>{/if}
      {#if compare.visual === 'side'}
        <div class="side">
          <figure>
            <figcaption><span class="tag a">A</span> {compare.base?.label} · {locale(compare.effectiveLangA)}</figcaption>
            <div class="frame" style:width={width ? `${width}px` : null}>
              {#if pA}<iframe title="Version A" srcdoc={pA.html} sandbox="allow-same-origin" onload={(e) => fit(e, 'A')}></iframe>{/if}
            </div>
          </figure>
          <figure>
            <figcaption><span class="tag b">B</span> Current draft{store.dirty ? ' (unsaved)' : ''} · {locale(store.lang)}</figcaption>
            <div class="frame" style:width={width ? `${width}px` : null}>
              {#if pB}<iframe title="Version B (current draft)" srcdoc={pB.html} sandbox="allow-same-origin" onload={(e) => fit(e, 'B')}></iframe>{/if}
            </div>
          </figure>
        </div>
      {:else}
        <div class="stack" style:width={width ? `${width}px` : null} style:height={`${Math.max(hA, hB)}px`}>
          {#if pA}<iframe class="a" title="Version A" srcdoc={pA.html} sandbox="allow-same-origin" onload={(e) => fit(e, 'A')}></iframe>{/if}
          {#if pB}
            <iframe
              class="b {compare.visual}"
              title="Version B (current draft)"
              srcdoc={pB.html}
              sandbox="allow-same-origin"
              onload={(e) => fit(e, 'B')}
              style:opacity={compare.visual === 'overlay' ? compare.amount / 100 : null}
              style:clip-path={compare.visual === 'swipe' ? `inset(0 0 0 ${compare.amount}%)` : null}
            ></iframe>
          {/if}
          {#if compare.visual === 'swipe'}<div class="handle" style:left={`${compare.amount}%`} aria-hidden="true"><span>A | B</span></div>{/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="ctabs" role="tablist" aria-label="Source and output">
      {#each CODE_TABS as [k, label]}
        <button role="tab" aria-selected={compare.codeTab === k} class:active={compare.codeTab === k} onclick={() => (compare.codeTab = k)}
          aria-label={`${label}: ${counts[k] ? `${counts[k]} changed block(s)` : 'no changes'}`}>
          {label} <span class="count" class:zero={!counts[k]} aria-hidden="true">{counts[k] || '='}</span>
        </button>
      {/each}
      <span class="grow"></span>
      <span class="muted legend"><span class="tag a">A</span> {compare.base?.label} · <span class="tag b">B</span> current draft{current[5] && canEdit ? ' (editable: ⇥ copies a chunk from A)' : ''}</span>
    </div>
    <div class="code" role="tabpanel">
      {#key compare.codeTab}
        <DiffEditor
          a={current[2]}
          b={current[3]}
          lang={current[4]}
          editable={current[5] && canEdit}
          labelA={`A: ${compare.base?.label ?? ''}`}
          labelB="B: current draft"
          onchange={(text) => onchange(current[0], text)}
        />
      {/key}
    </div>
  {/if}
</section>

<style>
  .compare { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #f4f4f5; }
  .bar, .vbar, .ctabs { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .vbar, .ctabs { background: var(--panel-2); padding: 6px 16px; }
  .src { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .src select { max-width: 420px; }
  .langs { display: flex; align-items: center; gap: 6px; }
  .langs label { display: flex; align-items: center; gap: 4px; }
  .check { display: flex; align-items: center; gap: 4px; font-size: 12px; }
  .grow { flex: 1; }
  .tag { display: inline-grid; place-content: center; width: 18px; height: 18px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; }
  .tag.a { background: #b45309; }
  .tag.b { background: #4338ca; }
  .summary { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0; padding: 8px 16px; background: #fff; border-bottom: 1px solid var(--border); font-size: 12px; }
  .summary div { display: flex; gap: 6px; align-items: baseline; }
  .summary dt { color: #52525b; }
  .summary dd { margin: 0; }
  .summary .changed dt { color: #92400e; font-weight: 600; }
  .summary del { color: #991b1b; }
  .summary ins { color: #166534; text-decoration: none; background: #dcfce7; }
  .summary .bad { color: #b91c1c; }
  .verdict { margin: 0; padding: 4px 16px 6px; background: #fff; border-bottom: 1px solid var(--border); font-size: 12px; color: #3f3f46; }
  .same { color: #166534; font-weight: 600; }
  .range { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .hint { font-size: 12px; }
  .stage-wrap { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
  .side { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  figure { margin: 0; min-width: 0; }
  figcaption { font-size: 12px; color: #3f3f46; margin-bottom: 6px; display: flex; gap: 6px; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .frame { margin: 0 auto; max-width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  iframe { display: block; width: 100%; border: 0; min-height: 200px; background: #fff; }
  .stack { position: relative; margin: 0 auto; max-width: 900px; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .stack iframe { position: absolute; inset: 0 auto auto 0; width: 100%; }
  .stack iframe.difference { mix-blend-mode: difference; }
  .handle { position: absolute; top: 0; bottom: 0; width: 2px; background: #4338ca; pointer-events: none; }
  .handle span { position: sticky; top: 8px; display: inline-block; transform: translateX(-50%); background: #4338ca; color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
  .ctabs button { font-size: 12px; }
  .count { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 11px; text-align: center; }
  .count.zero { background: #f4f4f5; color: #52525b; }
  .legend { font-size: 12px; display: flex; gap: 4px; align-items: center; }
  .code { flex: 1; min-height: 0; }
  .error { color: #b91c1c; margin: 8px 16px; }
  .spinner { width: 14px; height: 14px; border: 2px solid #c7d2fe; border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 900px) { .side { grid-template-columns: 1fr; } }
</style>
