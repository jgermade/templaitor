<script>
  // Flag of a locale as an SVG image (es-ES → Spain). Without a region the language code is shown.
  import { flagUrl } from '../lib/flags.js'

  let { locale, size = 18 } = $props()
  let src = $state(null)
  $effect(() => {
    const l = locale
    src = null
    flagUrl(l).then((u) => { if (l === locale) src = u })
  })
  const code = $derived(String(locale || '').split('-')[0].toUpperCase())
</script>

{#if src}
  <img class="flag" {src} alt="" width={Math.round(size * 1.5)} height={size} />
{:else}
  <span class="code" aria-hidden="true">{code}</span>
{/if}

<style>
  .flag { display: inline-block; vertical-align: -0.2em; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0, 0, 0, .12); object-fit: cover; }
  .code { display: inline-block; font: 600 10px/16px var(--mono); padding: 0 3px; border: 1px solid #d4d4d8; border-radius: 3px; color: #3f3f46; }
</style>
