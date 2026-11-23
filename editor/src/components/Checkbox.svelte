<script>
  // Checkbox / radio drawn with SVG: the native input stays in place (keyboard, screen readers, forms) but is
  // invisible; the box next to it shows the state.
  import Icon from './Icon.svelte'

  let {
    checked = $bindable(false), group = $bindable(), type = 'checkbox', value = undefined,
    disabled = false, onchange = undefined, class: cls = '', children,
  } = $props()
</script>

<label class="cb {cls}" class:disabled>
  {#if type === 'radio'}
    <input type="radio" bind:group {value} {disabled} {onchange} />
    <span class="box round" aria-hidden="true"><svg viewBox="0 0 24 24" width="10" height="10"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg></span>
  {:else}
    <input type="checkbox" bind:checked {disabled} {onchange} />
    <span class="box" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span>
  {/if}
  {#if children}<span class="txt">{@render children()}</span>{/if}
</label>

<style>
  .cb { position: relative; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .cb.disabled { opacity: .5; cursor: default; }
  input { position: absolute; left: 0; top: 50%; width: 16px; height: 16px; margin: -8px 0 0; opacity: 0; cursor: inherit; }
  .box {
    flex: none; display: inline-grid; place-content: center; width: 16px; height: 16px; border-radius: 4px;
    border: 1.5px solid #71717a; background: #fff; color: transparent; transition: background .1s, border-color .1s;
  }
  .box.round { border-radius: 50%; }
  input:checked + .box { background: var(--accent); border-color: var(--accent); color: #fff; }
  input[type='radio']:checked + .box { background: #fff; color: var(--accent); }
  input:focus-visible + .box { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cb:hover input:not(:disabled):not(:checked) + .box { border-color: #3f3f46; }
</style>
