import path from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import { loadProject } from './src/engine/project.js'
import { createHandler } from './src/server/server.js'

// Proyecto que sirve la API en desarrollo (make up PROJECT=...)
const PROJECT = process.env.TEMPLAITOR_PROJECT || 'examples/demo'
// Mailpit local (docker compose) publicado en /mailpit/ del mismo servidor
const MAILPIT = process.env.TEMPLAITOR_MAILPIT || 'http://127.0.0.1:8025'
// hosts públicos permitidos (p.ej. el subdominio de intergate: make up GATE=...)
const ALLOWED_HOSTS = (process.env.TEMPLAITOR_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)

/** Monta la API del motor (/api, /static) dentro del servidor de Vite: un único puerto en desarrollo */
function templaitorApi() {
  return {
    name: 'templaitor-api',
    configureServer(server) {
      const project = loadProject(path.resolve(PROJECT))
      const handle = createHandler(project)
      server.config.logger.info(`  ✎ templaitor · ${project.name} (${path.relative(process.cwd(), project.cwd) || '.'})`)
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (url.startsWith('/api/') || url.startsWith('/static/')) return handle(req, res)
        next()
      })
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('./editor', import.meta.url)),
  base: './',
  plugins: [svelte(), templaitorApi()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    allowedHosts: ALLOWED_HOSTS,
    proxy: {
      // bandeja de Mailpit (incluye el websocket de actualizaciones en vivo)
      '/mailpit': { target: MAILPIT, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/editor', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
