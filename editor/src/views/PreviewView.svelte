<script>
  import Canvas from './Canvas.svelte'
  import CodeEditor from '../components/CodeEditor.svelte'
  import { store } from '../stores/editor.svelte.js'
</script>

<div class="preview">
  <aside>
    <div class="panel-title">
      Datos de demo <span class="mono muted">{store.doc.name}.json5</span>
      <span class="grow"></span>
      {#if store.demoData === null}<span class="bad">JSON5 no válido</span>{/if}
    </div>
    <div class="cm"><CodeEditor lang="json5" value={store.doc.data} onchange={(v) => store.update({ data: v }, 'code:data')} onsave={() => store.save()} /></div>
  </aside>
  <section>
    {#if store.view === 'text'}
      <pre>{store.preview.text}</pre>
    {:else}
      <Canvas mode="preview" />
    {/if}
  </section>
</div>

<style>
  .preview { display: grid; grid-template-columns: 340px minmax(0, 1fr); height: 100%; min-height: 0; }
  aside { display: flex; flex-direction: column; min-height: 0; background: var(--panel); border-right: 1px solid var(--border); }
  .cm { flex: 1; min-height: 0; display: flex; }
  .cm > :global(.cm-host) { flex: 1; }
  .grow { flex: 1; }
  .bad { color: var(--danger); text-transform: none; }
  section { min-height: 0; overflow: auto; }
  pre {
    margin: 16px auto; max-width: 680px; background: #fff; border: 1px solid var(--border); border-radius: 8px;
    padding: 20px 24px; white-space: pre-wrap; font: 13px/1.6 var(--mono);
  }
</style>
