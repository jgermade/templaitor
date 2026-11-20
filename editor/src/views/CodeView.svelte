<script>
  import CodeEditor from '../components/CodeEditor.svelte'
  import Canvas from './Canvas.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'

  let tab = $state('mjml')
  let auxPath = $state(null)
  let aux = $state({ content: '', saved: '' })

  const name = $derived(store.doc?.name)
  const TABS = $derived([
    ['mjml', `${name}.mjml`],
    ['yml', `${name}.yml`],
    ['data', `${name}.json5`],
    ['files', 'Layouts y compartidos'],
  ])

  $effect(() => {
    if (tab === 'files' && !auxPath && store.project?.files?.length) openAux(store.project.files[0])
  })

  async function openAux(path) {
    if (aux.content !== aux.saved && !(await confirmDialog({ title: 'Cambios sin guardar', message: `Hay cambios sin guardar en ${auxPath}. ¿Descartarlos?`, okLabel: 'Descartar', danger: true }))) return
    const f = await api.file(path)
    auxPath = path
    aux = { content: f.content, saved: f.content }
  }

  async function saveAux() {
    try {
      await api.saveFile(auxPath, aux.content)
      aux = { ...aux, saved: aux.content }
      store.notify(`Guardado ${auxPath}`)
      store.previewNonce++
      if (auxPath.endsWith('.yml')) store.refreshTemplates()
    } catch (e) { store.notify(e.message, 'error') }
  }

  const langOf = (p) => (p?.endsWith('.mjml') ? 'xml' : p?.match(/\.ya?ml$/) ? 'yaml' : 'json5')
</script>

<div class="code">
  <div class="editor">
    <nav>
      {#each TABS as [id, label]}
        <button class="tab" class:active={tab === id} onclick={() => (tab = id)}>{label}</button>
      {/each}
    </nav>
    <div class="cm">
      {#if tab === 'mjml'}
        <CodeEditor lang="xml" value={store.doc.mjml} onchange={(v) => store.update({ mjml: v }, 'code:mjml')} onsave={() => store.save()} />
      {:else if tab === 'yml'}
        <CodeEditor lang="yaml" value={store.doc.yml} onchange={(v) => store.update({ yml: v }, 'code:yml')} onsave={() => store.save()} />
      {:else if tab === 'data'}
        <CodeEditor lang="json5" value={store.doc.data} onchange={(v) => store.update({ data: v }, 'code:data')} onsave={() => store.save()} />
      {:else}
        <div class="auxbar">
          <select value={auxPath} onchange={(e) => openAux(e.currentTarget.value)}>
            {#each store.project?.files || [] as f}<option value={f}>{f}</option>{/each}
          </select>
          <span class="grow"></span>
          <button class="primary" disabled={aux.content === aux.saved} onclick={saveAux}>Guardar fichero</button>
        </div>
        {#key auxPath}
          {#if auxPath}
            <CodeEditor lang={langOf(auxPath)} value={aux.content} onchange={(v) => (aux.content = v)} onsave={saveAux} />
          {/if}
        {/key}
      {/if}
    </div>
  </div>
  <div class="live">
    <Canvas mode="preview" />
  </div>
</div>

<style>
  .code { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); height: 100%; min-height: 0; }
  .editor { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); background: var(--panel); }
  nav { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--border); background: var(--panel-2); }
  .tab { border-radius: 6px 6px 0 0; border-bottom: 0; background: transparent; font-family: var(--mono); font-size: 12px; }
  .tab.active { background: #fff; border-color: var(--border); position: relative; top: 1px; }
  .cm { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .cm > :global(.cm-host) { flex: 1; }
  .auxbar { display: flex; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .grow { flex: 1; }
  .live { min-height: 0; }
</style>
