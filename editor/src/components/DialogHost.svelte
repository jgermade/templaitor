<script>
  // Renders the active modal from lib/dialogs (a single <dialog> for the whole app)
  import { dialogs } from '../lib/dialogs.svelte.js'

  let dialog = $state()
  let input = $state()
  let value = $state('')

  const d = $derived(dialogs.current)

  $effect(() => {
    if (!dialog) return
    if (d && !dialog.open) {
      value = d.value ?? ''
      dialog.showModal()
      queueMicrotask(() => (d.type === 'prompt' ? input?.select() : dialog.querySelector('button.ok')?.focus()))
    }
    if (!d && dialog.open) dialog.close()
  })

  function submit(e) {
    e.preventDefault()
    if (d.type === 'prompt') {
      const v = value.trim()
      if (!v) return input?.focus()
      dialogs.close(v)
    } else {
      dialogs.close(true)
    }
  }

  const cancel = () => dialogs.close(d?.type === 'confirm' ? false : null)
</script>

<dialog bind:this={dialog} oncancel={(e) => { e.preventDefault(); cancel() }} onclick={(e) => { if (e.target === dialog) cancel() }}>
  {#if d}
    <form onsubmit={submit}>
      <h3>{d.title}</h3>
      {#if d.message}<p class="msg">{d.message}</p>{/if}
      {#if d.type === 'prompt'}
        <label class="field">
          {#if d.label}<span>{d.label}</span>{/if}
          <input bind:this={input} bind:value type={d.inputType} placeholder={d.placeholder} pattern={d.pattern} required class:mono={d.inputType === 'text'} />
        </label>
        {#if d.hint}<p class="hint">{d.hint}</p>{/if}
      {/if}
      <div class="actions">
        <button type="button" onclick={cancel}>{d.cancelLabel}</button>
        <button type="submit" class="ok" class:primary={!d.danger} class:danger-btn={d.danger}>{d.okLabel}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    border: 1px solid var(--border); border-radius: 12px; padding: 0; width: min(440px, calc(100vw - 32px));
    box-shadow: 0 24px 60px rgba(0, 0, 0, .22); color: var(--text);
  }
  dialog::backdrop { background: rgba(24, 24, 27, .38); backdrop-filter: blur(2px); }
  dialog[open] { animation: pop .14s ease-out; }
  @keyframes pop { from { transform: translateY(6px) scale(.98); opacity: 0; } }
  form { padding: 18px 20px 16px; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  .msg { margin: 0 0 12px; color: #3f3f46; white-space: pre-line; }
  .field input { width: 100%; padding: 7px 10px; font-size: 14px; }
  .hint { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .actions button { padding: 6px 14px; }
  .danger-btn { background: var(--danger); border-color: var(--danger); color: #fff; }
  .danger-btn:hover { background: #b91c1c !important; }
</style>
