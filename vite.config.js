import path from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import { loadProject } from './src/engine/project.js'
import { createHandler } from './src/server/server.js'

// Project served by the API in development (make up PROJECT=...)
const PROJECT = process.env.TEMPLAITOR_PROJECT || 'examples/demo'
// Local Mailpit (docker compose) published under /mailpit/ of the same server
const MAILPIT = process.env.TEMPLAITOR_MAILPIT || 'http://127.0.0.1:8025'
// allowed public hosts (e.g. the intergate subdomain: make up GATE=...)
const ALLOWED_HOSTS = (process.env.TEMPLAITOR_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)

/** Mounts the engine API (/api, /static) inside the Vite server: a single port in development */
function templaitorApi() {
  return {
    name: 'templaitor-api',
    configureServer(server) {
      const project = loadProject(path.resolve(PROJECT))
      const handle = createHandler(project)
      server.config.logger.info(`  ✎ templaitor · ${project.name} (${path.relative(process.cwd(), project.cwd) || '.'})`)
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (url.startsWith('/api/') || url.startsWith('/static/') || url.startsWith('/preview/')) return handle(req, res)
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
      '@flags': fileURLToPath(new URL('./node_modules/country-flag-icons/3x2', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    allowedHosts: ALLOWED_HOSTS,
    proxy: {
      // Mailpit inbox (including the live-update websocket)
      '/mailpit': { target: MAILPIT, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/editor', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
