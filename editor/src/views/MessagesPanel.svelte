<script>
  import { store } from '../stores/editor.svelte.js'
  import { flagOf } from '../lib/flags.js'

  let newKey = $state('')
  let newLang = $state('')

  const keys = $derived([...new Set(store.langs.flatMap(l => Object.keys(store.i18n.messages?.[l] || {})))])
  const used = $derived(new Set([...(store.doc?.mjml || '').matchAll(/\$t\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])))

  function add(e) {
    e.preventDefault()
    const k = newKey.trim()
    if (!k) return
    store.addMessage(k, '')
    newKey = ''
  }

  const autosize = (el) => {
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` }
    fit()
    el.addEventListener('input', fit)
    return { update: fit, destroy: () => el.removeEventListener('input', fit) }
  }
</script>

<div class="langs">
  {#each store.langs as l}
    {@const locale = store.project?.locales?.[l] || l}
    <span class="lang" class:active={store.lang === l}>
      <button class="ghost" onclick={() => (store.lang = l)} title={locale}>{flagOf(locale) ?? ''} <span class="mono">{l}</span></button>
      {#if store.langs.length > 1}<button class="ghost x" title="Eliminar idioma {l}" onclick={() => store.removeLang(l)}>✕</button>{/if}
    </span>
  {/each}
  <form onsubmit={(e) => { e.preventDefault(); store.addLang(newLang.trim(), store.lang); newLang = '' }}>
    <input class="mono" placeholder="+ idioma" bind:value={newLang} list="tpl-langs" size="6" />
    <datalist id="tpl-langs">
      {#each Object.keys(store.project?.locales || {}).filter(l => !store.langs.includes(l)) as l}<option value={l}></option>{/each}
    </datalist>
  </form>
</div>

<ul>
  {#each keys as key (key)}
    {@const msg = store.messages[key]}
    <li class:missing={msg == null}>
      <div class="k">
        <code title={used.has(key) ? 'Usada en la plantilla' : 'No se usa en la plantilla'} class:unused={!used.has(key)}>{key}</code>
        {#if msg == null}<span class="warn">sin traducción</span>{/if}
        <button class="ghost x" title="Eliminar la clave en todos los idiomas" onclick={() => store.removeKey(key)}>✕</button>
      </div>
      <textarea rows="1" use:autosize={msg} value={msg == null ? '' : String(msg).trim()} oninput={(e) => store.setMessage(store.lang, key, e.currentTarget.value)}></textarea>
    </li>
  {/each}
</ul>
<form class="add" onsubmit={add}>
  <input class="mono" placeholder="nueva_clave" bind:value={newKey} />
  <button type="submit" disabled={!newKey.trim()}>Añadir</button>
</form>

<style>
  .langs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0 14px 8px; }
  .lang { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
  .lang.active { border-color: #a5b4fc; background: var(--accent-soft); }
  .lang button { padding: 1px 6px; }
  .x { color: var(--muted); font-size: 10px; padding: 0 5px; }
  ul { list-style: none; margin: 0; padding: 0 14px; display: grid; gap: 8px; }
  .k { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
  .k code { font-size: 11px; color: #3730a3; }
  .k code.unused { color: var(--muted); }
  .k .x { margin-left: auto; visibility: hidden; }
  li:hover .k .x { visibility: visible; }
  .warn { color: var(--danger); font-size: 11px; }
  textarea { width: 100%; resize: none; overflow: hidden; line-height: 1.45; font-size: 12.5px; }
  .missing textarea { border-color: #fca5a5; }
  .add { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 10px 14px 0; }
</style>
