<script>
  import { ICONS } from './Icon.svelte'
  // Side-by-side diff (CodeMirror merge view). A is read-only; B can be editable, with controls to
  // copy a chunk of A into B (revert).
  import { onMount, untrack } from 'svelte'
  import { MergeView } from '@codemirror/merge'
  import { EditorView, basicSetup } from 'codemirror'
  import { EditorState } from '@codemirror/state'
  import { xml } from '@codemirror/lang-xml'
  import { yaml } from '@codemirror/lang-yaml'
  import { javascript } from '@codemirror/lang-javascript'

  let { a = '', b = '', lang = 'xml', editable = false, onchange, labelA = 'Version A', labelB = 'Version B' } = $props()

  let el
  let view = null
  const langs = { xml: () => xml(), yaml: () => yaml(), json5: () => javascript(), html: () => xml(), text: () => [] }

  function build() {
    view?.destroy()
    const common = [basicSetup, (langs[lang] || langs.text)(), EditorView.lineWrapping, EditorView.theme({
      '&': { fontSize: '12.5px' },
      '.cm-scroller': { fontFamily: 'var(--mono)' },
      '.cm-gutters': { background: '#fafafa', borderRight: '1px solid var(--border)' },
    })]
    view = new MergeView({
      parent: el,
      a: { doc: untrack(() => a), extensions: [...common, EditorState.readOnly.of(true), EditorView.contentAttributes.of({ 'aria-label': `${labelA} (read-only)` })] },
      b: {
        doc: untrack(() => b),
        extensions: [
          ...common,
          EditorState.readOnly.of(!editable),
          EditorView.contentAttributes.of({ 'aria-label': editable ? labelB : `${labelB} (read-only)` }),
          EditorView.updateListener.of((u) => { if (u.docChanged) onchange?.(u.state.doc.toString()) }),
        ],
      },
      revertControls: editable ? 'a-to-b' : undefined,
      renderRevertControl: () => {
        const btn = document.createElement('button')
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS['to-line']}</svg>`
        btn.title = 'Copy this chunk from A into the draft'
        btn.setAttribute('aria-label', 'Copy this chunk from A into the draft')
        btn.className = 'revert'
        return btn
      },
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    })
  }

  onMount(() => () => view?.destroy())

  // rebuilt when the base, the language or the editability change
  $effect(() => {
    void a; void lang; void editable; void labelA; void labelB
    untrack(build)
  })

  // external changes of B (undo, other views) without rebuilding
  $effect(() => {
    const v = b
    if (view && v !== view.b.state.doc.toString()) view.b.dispatch({ changes: { from: 0, to: view.b.state.doc.length, insert: v } })
  })
</script>

<div class="diff" bind:this={el}></div>

<style>
  .diff { height: 100%; min-height: 0; }
  .diff :global(.cm-mergeView) { height: 100%; overflow: auto; background: #fff; }
  .diff :global(.cm-mergeViewEditors) { min-height: 100%; }
  .diff :global(.cm-merge-revert button.revert) { padding: 0 4px; font-size: 12px; line-height: 1.2; color: #1d4ed8; }
</style>
