<script>
  import { onMount } from 'svelte'
  import { EditorView, basicSetup } from 'codemirror'
  import { EditorState } from '@codemirror/state'
  import { keymap } from '@codemirror/view'
  import { xml } from '@codemirror/lang-xml'
  import { yaml } from '@codemirror/lang-yaml'
  import { javascript } from '@codemirror/lang-javascript'
  import { oneDark } from '@codemirror/theme-one-dark'

  let { value = '', lang = 'xml', onchange, onsave, readonly = false, dark = false, gutters = true } = $props()

  let el
  let view

  const langs = { xml: () => xml(), yaml: () => yaml(), json5: () => javascript() }

  onMount(() => {
    view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { onsave?.(); return true } }]),
          basicSetup,
          ...(dark ? [oneDark] : []),
          (langs[lang] || langs.xml)(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readonly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange?.(u.state.doc.toString())
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '12.5px' },
            '.cm-scroller': { fontFamily: 'var(--mono)' },
            '.cm-gutters': dark ? { display: gutters ? '' : 'none' } : { background: '#fafafa', borderRight: '1px solid var(--border)', display: gutters ? '' : 'none' },
            ...(dark ? { '&': { height: '100%', fontSize: '12.5px', background: '#1e1f24' }, '.cm-gutters': { background: '#1e1f24', border: 'none', display: gutters ? '' : 'none' } } : {}),
          }, { dark }),
        ],
      }),
    })
    return () => view.destroy()
  })

  // syncs external changes (e.g. visual edits, undo)
  $effect(() => {
    const v = value
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
    }
  })
</script>

<div class="cm-host" bind:this={el}></div>

<style>
  .cm-host { height: 100%; min-height: 0; overflow: hidden; }
</style>
