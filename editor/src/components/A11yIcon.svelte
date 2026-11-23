<script>
  // Accessibility mark: white figure on a blue circle, with a status badge (pass: green check,
  // warn: amber "!", fail: red cross). `status: null` draws the mark without a badge.
  let { status = 'pass', size = 20, label = null } = $props()
  const BADGE = { pass: '#16a34a', warn: '#d97706', fail: '#dc2626' }
</script>

<svg
  class="a11y-icon" width={size} height={size} viewBox="0 0 26 26" focusable="false"
  role={label ? 'img' : undefined} aria-label={label ?? undefined} aria-hidden={label ? undefined : 'true'}
>
  <circle cx="12" cy="12" r="11.5" fill="#1479b8" />
  <circle cx="12" cy="5.6" r="2" fill="#fff" />
  <path d="M5.2 8.6 10 9.2h4l4.8-.6" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M10.1 9.3h3.8v4.6l1.2 5.9h-1.9L12 15.1l-1.2 4.7H8.9l1.2-5.9z" fill="#fff" stroke="#fff" stroke-width=".6" stroke-linejoin="round" />
  {#if status && BADGE[status]}
    <circle cx="20" cy="20" r="5.6" fill={BADGE[status]} stroke="#fff" stroke-width="1.4" />
    {#if status === 'pass'}
      <path d="m17.5 20.1 1.7 1.7 3.4-3.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    {:else if status === 'warn'}
      <path d="M20 17.4v3.2M20 22.6v.1" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" />
    {:else}
      <path d="m18 18 4 4m0-4-4 4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
    {/if}
  {/if}
</svg>

<style>
  .a11y-icon { display: inline-block; flex: none; vertical-align: -0.3em; }
</style>
