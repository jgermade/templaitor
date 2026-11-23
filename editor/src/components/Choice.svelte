<script>
  // Button choice (a radio group drawn as buttons) for a few fixed options, instead of a <select>.
  //   <Choice label="Format" bind:value options={[{ value: 'email', label: 'Email', icon: 'email' }, …]} />
  // Keyboard: Tab enters the group on the chosen option; arrow keys move and choose (WAI-ARIA radio group).
  import Icon from './Icon.svelte'

  let { options = [], value = $bindable(), label, onchange, disabled = false, size = 'md' } = $props()
  let buttons = $state([])

  function choose(v) {
    if (disabled || v === value) return
    value = v
    onchange?.(v)
  }

  function onkeydown(e, i) {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!d) return
    e.preventDefault()
    const n = (i + d + options.length) % options.length
    choose(options[n].value)
    buttons[n]?.focus()
  }
</script>

<div class="choice {size}" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
  {#each options as o, i (o.value)}
    <button
      type="button" role="radio" bind:this={buttons[i]}
      aria-checked={o.value === value} tabindex={o.value === value || (value == null && i === 0) ? 0 : -1}
      class:on={o.value === value} style:--tint={o.color ?? null} {disabled} title={o.title ?? null}
      onclick={() => choose(o.value)} onkeydown={(e) => onkeydown(e, i)}
    >
      {#if o.icon}<Icon name={o.icon} size={size === 'sm' ? 14 : 16} />{/if}
      <span>{o.label}</span>
    </button>
  {/each}
</div>

<style>
  .choice { display: flex; gap: 6px; }
  button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 10px;
    border: 1px solid var(--border); border-radius: var(--radius); background: #fff; color: #3f3f46; font-weight: 500;
  }
  .sm button { padding: 4px 8px; font-size: 12px; gap: 5px; }
  button :global(.icon) { color: var(--tint, #71717a); }
  button:hover:not(:disabled):not(.on) { border-color: #a1a1aa; }
  button.on { border-color: var(--tint, var(--accent)); background: color-mix(in srgb, var(--tint, var(--accent)) 8%, #fff); color: #18181b; box-shadow: inset 0 0 0 1px var(--tint, var(--accent)); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
