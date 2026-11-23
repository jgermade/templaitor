<script>
  import Icon from '../components/Icon.svelte'
  // Versions of the open document: save the current state as a version, browse them, compare or restore one.
  import { store } from '../stores/editor.svelte.js'
  import { versions } from '../stores/versions.svelte.js'
  import { session } from '../lib/service.svelte.js'

  let { open = $bindable(false) } = $props()
  let dialog = $state()
  let message = $state('')
  let input = $state()

  $effect(() => {
    if (open) {
      dialog?.showModal()
      versions.load().then(() => input?.focus())
    } else dialog?.close()
  })

  const d = $derived(versions.data)
  const kindLabel = $derived(store.isComponent ? 'component' : store.isLayout ? 'layout' : 'template')
  const status = $derived(
    store.dirty ? 'The draft has unsaved changes: saving a version saves them first.'
      : d.dirty ? (versions.latest ? `Saved changes since ${versions.label(versions.latest)} are not in a version yet.` : `This ${kindLabel} has no versions yet.`)
        : versions.latest ? `Up to date with ${versions.label(versions.latest)}.` : '',
  )

  async function save(e) {
    e.preventDefault()
    if (await versions.save(message)) message = ''
  }

  async function restore(v) {
    if (await versions.restore(v)) open = false
  }

  async function compareWith(v) {
    open = false
    await versions.compareWith(v)
  }

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  function ago(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000
    for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit)
    }
    return 'just now'
  }
</script>

<dialog bind:this={dialog} class="versions" aria-labelledby="versions-title" oncancel={(e) => { e.preventDefault(); open = false }}>
  <div class="dhead">
    <h2 id="versions-title">Versions <span class="muted doc">· {store.doc?.id}</span></h2>
    <button class="ghost" aria-label="Close versions" onclick={() => (open = false)}><Icon name="x" size={16} /></button>
  </div>

  <div class="body" aria-busy={versions.loading}>
    {#if versions.error}<p class="error" role="alert">{versions.error}</p>{/if}

    {#if versions.forDoc !== `${store.kind}:${store.doc?.id}`}
      {#if versions.loading}<p class="muted">Loading…</p>{/if}
    {:else if !d.available}
      <div class="off">
        {#if d.canInit}
          <p>This project is not in a <b>git</b> repository. Versions are git commits of each {kindLabel}'s files, so you
            can also use them from the terminal or push them to a remote.</p>
          {#if session.canEdit}
            <button class="primary" disabled={versions.busy} onclick={() => versions.init()}>Create a git repository</button>
            <p class="muted small">Runs <code>git init</code> in the project folder, ignores the compiled output and saves a first
              version of every document.</p>
          {/if}
        {:else}
          <p>Versions are not available: {d.reason || 'unknown reason'}.</p>
        {/if}
      </div>
    {:else}
      <p class="where muted small">
        {#if d.backend === 'git'}Stored as <b>git</b> commits{d.branch ? ` on ${d.branch}` : ''} · only this {kindLabel}'s files are committed{:else}Stored in the database{/if}
      </p>

      {#if session.canEdit}
        <form class="new" onsubmit={save}>
          <label for="version-message">Describe this version</label>
          <div class="row">
            <input id="version-message" bind:this={input} bind:value={message} maxlength="500" placeholder={`Update ${store.doc?.id ?? ''}`} />
            <button class="primary" type="submit" disabled={versions.busy || !versions.pending}>Save version</button>
          </div>
        </form>
      {/if}
      <p class="status" aria-live="polite">{status}</p>

      {#if d.versions.length}
        <ol class="list" aria-label="Versions, newest first">
          {#each d.versions as v, i (v.rev)}
            <li>
              <span class="num" aria-hidden="true">{versions.label(v)}</span>
              <div class="info">
                <span class="msg"><span class="sr">{versions.label(v)}: </span>{v.message}</span>
                <span class="meta">
                  {v.author} · <time datetime={v.date} title={new Date(v.date).toLocaleString()}>{ago(v.date)}</time>
                  {#if d.backend === 'git'} · <code>{v.short}</code>{/if}
                  {#if i === 0 && !versions.pending} · <span class="current">current</span>{/if}
                </span>
              </div>
              <div class="actions">
                <a class="btn" href={store.previewUrl({ version: v.rev })} target="_blank" rel="noopener" aria-label={`Preview ${versions.label(v)} in a new tab`} title="Preview in a new tab (shareable URL)"><Icon name="external" size={13} /></a>
                <button onclick={() => compareWith(v)} aria-label={`Compare ${versions.label(v)} with the draft`}>Compare</button>
                {#if session.canEdit}
                  <button onclick={() => restore(v)} disabled={versions.busy} aria-label={`Restore ${versions.label(v)} into the draft`}>Restore</button>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      {:else if !versions.loading}
        <p class="muted">No versions yet.</p>
      {/if}
    {/if}
  </div>
</dialog>

<style>
  .versions { border: 1px solid var(--border); border-radius: 12px; padding: 0; width: min(640px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); color: var(--text); }
  .versions::backdrop { background: rgba(24, 24, 27, .38); }
  .versions[open] { display: flex; flex-direction: column; }
  .dhead { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  h2 { margin: 0; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .doc { font-weight: 400; font-size: 13px; }
  .body { padding: 4px 16px 16px; overflow: auto; }
  .where { margin: 10px 0; }
  .new label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; min-width: 0; }
  .status { font-size: 12px; color: #52525b; min-height: 1em; margin: 6px 0 12px; }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); }
  .num { flex: none; min-width: 38px; text-align: center; font-size: 12px; font-weight: 600; color: #3730a3; background: var(--accent-soft); border-radius: 999px; padding: 2px 6px; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .msg { overflow-wrap: anywhere; }
  .meta { font-size: 12px; color: #52525b; }
  .current { color: #166534; font-weight: 600; }
  .actions { display: flex; gap: 4px; flex: none; }
  .actions button { font-size: 12px; padding: 3px 8px; }
  .actions .btn { display: inline-grid; place-content: center; padding: 3px 7px; border: 1px solid var(--border); border-radius: var(--radius); color: inherit; }
  .actions .btn:hover { border-color: #a1a1aa; }
  .off { padding: 8px 0; }
  .small { font-size: 12px; }
  .error { color: #b91c1c; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  @media (max-width: 520px) {
    .list li { flex-wrap: wrap; }
    .actions { width: 100%; justify-content: flex-end; }
  }
</style>
