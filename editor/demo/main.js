// Entry point of the in-browser demo (GitHub Pages /demo/): starts the browser backend, then the editor.
import './shims/globals.js'

const banner = document.getElementById('demo-banner')
const reset = document.getElementById('demo-reset')

async function start() {
  const { startBackend } = await import('./backend.js')
  const backend = await startBackend()
  const search = new URLSearchParams(location.search)

  // shareable preview page: ?preview=<id>&lang=…
  if (search.has('preview')) {
    const { html } = await backend.previewHtml(location.search)
    document.open()
    document.write(html)
    document.close()
    return
  }

  globalThis.__TEMPLAITOR_HOST__ = {
    previewUrl: (path, params) => `${location.origin}${location.pathname}?${new URLSearchParams({ preview: decodeURIComponent(path), ...Object.fromEntries(params) })}`,
    staticUrl: (rel) => backend.staticUrl(rel),
  }
  banner.hidden = false
  reset.addEventListener('click', async () => {
    const dialog = document.getElementById('demo-reset-dialog')
    dialog.showModal()
    dialog.addEventListener('close', async () => {
      if (dialog.returnValue !== 'reset') return
      await fetch('/api/demo/reset', { method: 'POST' })
      location.hash = ''
      location.reload()
    }, { once: true })
  })
  await import('../src/main.js')
}

start().catch((err) => {
  console.error(err)
  document.getElementById('app').innerHTML = '<p style="font: 15px/1.5 system-ui, sans-serif; margin: 40px">The demo could not start in this browser.</p>'
})
