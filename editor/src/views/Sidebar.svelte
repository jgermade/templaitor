<script>
  import Section from '../components/Section.svelte'
  import CodeEditor from '../components/CodeEditor.svelte'
  import MessagesPanel from './MessagesPanel.svelte'
  import ComponentsPanel from './ComponentsPanel.svelte'
  import Outline from './Outline.svelte'
  import TemplateSettings from './TemplateSettings.svelte'
  import ParamsPanel from './ParamsPanel.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { PALETTE, describe } from '@shared/components.js'

  const design = $derived(store.view === 'design')
  const keyCount = $derived(Object.keys(store.messages).length)
  // altura inicial del editor de datos ajustada a su contenido (luego redimensionable)
  const dataHeight = $derived.by(() => {
    void store.doc.id
    const lines = (store.saved?.data ?? store.doc.data).split('\n').length
    return Math.min(360, Math.max(70, lines * 17.5 + 14))
  })
</script>

<aside>
  <div class="data" style="height: {dataHeight}px" title="Datos de demo ({store.doc.name}.json5)">
    {#key store.doc.kind + store.doc.id}
      <CodeEditor lang="json5" dark gutters={false} value={store.doc.data} onchange={(v) => store.update({ data: v }, 'code:data')} onsave={() => store.save()} />
    {/key}
    {#if store.demoData === null}<span class="bad">JSON5 no válido</span>{/if}
  </div>

  <div class="sections">
    {#if store.isLayout}
      <p class="borrowed">
        {#if store.doc.previewFrom}
          Vista previa con los textos y datos de <button class="link" onclick={() => store.open(store.doc.previewFrom)}>{store.doc.previewFrom}</button>
          (no se guardan con el layout).
        {:else}
          Ninguna plantilla usa este layout: la vista previa usa datos de ejemplo.
        {/if}
      </p>
    {:else}
      <Section id="messages" title="Mensajes" count={keyCount}>
        <MessagesPanel />
      </Section>
    {/if}

    {#if store.isComponent}
      <Section id="params" title="Parámetros" count={Object.keys(store.componentParams).length} open>
        <ParamsPanel />
      </Section>
    {/if}

    {#if design}
      <Section id="components" title="Componentes" count={store.components.length} open>
        <ComponentsPanel />
      </Section>

      <Section id="blocks" title="Bloques">
        <div class="palette">
          {#each PALETTE as tag}
            {@const d = describe(tag)}
            <button onclick={() => store.add(tag)} title="Añadir {d.label} ({tag})"><span class="ic">{d.icon}</span>{d.label}</button>
          {/each}
          {#if store.isPdf}
            <button onclick={() => store.addPageBreak()} title="Fuerza una página nueva en el PDF"><span class="ic">⤓</span>Salto de página</button>
          {/if}
        </div>
      </Section>

      <Section id="tree" title="Estructura" open>
        <Outline />
      </Section>
    {/if}

    <Section id="settings" title={store.isComponent ? 'Componente' : store.isLayout ? 'Layout' : 'Plantilla'}>
      <TemplateSettings />
    </Section>
  </div>
</aside>

<style>
  aside { display: flex; flex-direction: column; min-height: 0; background: #f4f4f5; border-right: 1px solid #e4e4e7; }
  .data {
    position: relative; flex: none; min-height: 60px; max-height: 70vh; resize: vertical; overflow: hidden;
    background: #1e1f24; display: flex;
  }
  .data > :global(.cm-host) { flex: 1; }
  .bad { position: absolute; right: 8px; bottom: 6px; color: #fca5a5; font-size: 11px; }
  .borrowed { margin: 0; padding: 10px 14px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); }
  .link { border: 0; background: none; padding: 0; color: #2563eb; text-decoration: underline; font-size: 12px; }
  .sections { flex: 1; overflow: auto; padding-bottom: 24px; }
  .palette { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; padding: 0 14px; }
  .palette button { display: flex; align-items: center; gap: 6px; text-align: left; font-size: 12px; padding: 4px 8px; }
  .palette .ic { width: 16px; text-align: center; color: var(--muted); }
</style>
