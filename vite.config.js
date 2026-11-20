import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const API = process.env.TEMPLAITOR_API || 'http://127.0.0.1:3333'

export default defineConfig({
  root: fileURLToPath(new URL('./editor', import.meta.url)),
  base: './',
  plugins: [svelte()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    proxy: { '/api': API, '/static': API },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/editor', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
