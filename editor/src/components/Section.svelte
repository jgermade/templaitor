<script>
  // Collapsible sidebar section; remembers its state per browser
  let { title, id, open = false, count = null, actions, children } = $props()

  // svelte-ignore state_referenced_locally
  const key = `tpl:section:${id}` // read once: the section id never changes
  // svelte-ignore state_referenced_locally
  let isOpen = $state((() => {
    try { const v = localStorage.getItem(key); return v === null ? open : v === '1' } catch { return open }
  })())

  function toggle(e) {
    isOpen = e.currentTarget.open
    try { localStorage.setItem(key, isOpen ? '1' : '0') } catch {}
  }
</script>

<details open={isOpen} ontoggle={toggle}>
  <summary>
    <span class="caret">▸</span>
    <span class="title">{title}</span>
    {#if count !== null}<span class="count">{count}</span>{/if}
    <span class="grow"></span>
    {#if actions}<span class="actions" role="none" onclick={(e) => e.preventDefault()}>{@render actions()}</span>{/if}
  </summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  details { border-top: 1px solid var(--border); }
  summary {
    display: flex; align-items: center; gap: 6px; padding: 9px 14px; cursor: pointer; list-style: none;
    font-size: 14px; user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: rgba(0,0,0,.025); }
  .caret { font-size: 10px; color: var(--muted); transition: transform .15s; width: 10px; }
  details[open] .caret { transform: rotate(90deg); }
  .count { font-size: 11px; color: var(--muted); background: #e9e9ec; border-radius: 999px; padding: 0 6px; }
  .grow { flex: 1; }
  .body { padding: 0 0 10px; }
</style>
