<script>
  import Icon from './Icon.svelte'
  let { toast } = $props()
  let visible = $state(false)
  $effect(() => {
    if (!toast) return
    visible = true
    const t = setTimeout(() => (visible = false), toast.type === 'error' ? 6000 : 3000)
    return () => clearTimeout(t)
  })
</script>

{#if toast && visible}
  <div class="toast {toast.type}" role="status">
    {toast.message}
    {#if toast.link}<a href={toast.link.href} target="_blank" rel="noopener">{toast.link.label} <Icon name="external" size={12} /></a>{/if}
  </div>
{/if}

<style>
  .toast {
    position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%); z-index: 50;
    background: #18181b; color: #fff; padding: 8px 14px; border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); max-width: min(90vw, 640px);
  }
  .toast.error { background: var(--danger); }
  .toast a { color: #a5b4fc; margin-left: 10px; font-weight: 600; }
  .toast.warn { background: var(--warn); }
</style>
