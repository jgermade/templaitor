<script>
  // Image field: URL + thumbnail + gallery of project images + upload.
  // Store-agnostic: receives the image list and the callbacks as props.
  let {
    value = '', placeholder = '', onchange,
    assets = [], assetsUrl = '', resolve = (v) => v, onupload,
  } = $props()

  let open = $state(false)
  let busy = $state(false)
  let input = $state()

  const shown = $derived(value || placeholder)
  const src = $derived(shown ? resolve(shown) : '')
  const urlOf = (path) => `${assetsUrl}/${path}`

  async function upload(e) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file || !onupload) return
    busy = true
    try {
      const saved = await onupload(file)
      if (saved) { onchange(urlOf(saved.path)); open = false }
    } finally {
      busy = false
    }
  }
</script>

<div class="image-field">
  <div class="row">
    <button type="button" class="thumb" class:empty={!src} onclick={() => (open = !open)} title="Choose an image">
      {#if src}<img src={src} alt="" />{:else}🖼{/if}
    </button>
    <input type="text" class="mono" {value} placeholder={placeholder || 'https://… or {{ variable }}'} oninput={(e) => onchange(e.currentTarget.value)} />
  </div>
  {#if open}
    <div class="gallery">
      {#each assets as a (a.path)}
        <button type="button" class="item" class:cur={value === urlOf(a.path)} title={a.path} onclick={() => { onchange(urlOf(a.path)); open = false }}>
          <img src={`/static/${a.path}`} alt="" loading="lazy" />
          <span>{a.path}</span>
        </button>
      {:else}
        <p class="muted">There are no images in the project.</p>
      {/each}
      {#if onupload}
        <button type="button" class="item upload" disabled={busy} onclick={() => input.click()}>
          <span class="plus">{busy ? '…' : '＋'}</span><span>Upload image</span>
        </button>
        <input bind:this={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onchange={upload} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .row { display: grid; grid-template-columns: 40px 1fr; gap: 6px; align-items: center; }
  .thumb {
    width: 40px; height: 32px; padding: 0; overflow: hidden; display: grid; place-content: center;
    background: repeating-conic-gradient(#f4f4f5 0 25%, #fff 0 50%) 0 0 / 10px 10px;
  }
  .thumb img { width: 40px; height: 32px; object-fit: contain; }
  .thumb.empty { color: var(--muted); }
  .gallery {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; padding: 6px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); max-height: 260px; overflow: auto;
  }
  .gallery p { grid-column: 1 / -1; margin: 4px; font-size: 12px; }
  .item { display: grid; gap: 3px; padding: 4px; font-size: 10px; text-align: center; }
  .item img { width: 100%; height: 52px; object-fit: contain; background: #fff; border-radius: 4px; }
  .item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  .item.cur { border-color: var(--accent); background: var(--accent-soft); }
  .upload .plus { height: 52px; display: grid; place-content: center; font-size: 20px; color: var(--accent); }
</style>
