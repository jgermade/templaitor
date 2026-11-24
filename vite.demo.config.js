// In-browser demo of the editor (GitHub Pages /demo/): the editor plus the real engine bundled for the
// browser, with Node built-ins replaced by shims (editor/demo/shims) and a virtual fs kept in IndexedDB.
//   npm run build:demo   → dist/demo
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const at = (p) => fileURLToPath(new URL(p, import.meta.url))
const shim = at('./editor/demo/shims/node.js')

export default defineConfig({
  root: at('./editor/demo'),
  base: './',
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: '@shared', replacement: at('./src/shared') },
      { find: '@engine', replacement: at('./src/engine') },
      { find: '@flags', replacement: at('./node_modules/country-flag-icons/3x2') },
      { find: /^(node:)?fs$/, replacement: at('./editor/demo/shims/fs.js') },
      { find: /^(node:)?path$/, replacement: 'path-browserify' },
      { find: /^(node:)?(os|child_process|module|url|http)$/, replacement: shim },
      // MJML's browser build (same version as `mjml`) and nunjucks' browser build
      { find: /^mjml$/, replacement: 'mjml-browser' },
      { find: /^nunjucks$/, replacement: 'nunjucks/browser/nunjucks.js' },
      // never loaded (the demo has no SMTP), kept out of the bundle
      { find: /^nodemailer$/, replacement: shim },
    ],
  },
  define: {
    // mjml-browser and friends read process.env.NODE_ENV
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: { port: 5181, fs: { allow: [at('.')] } },
  build: {
    outDir: at('./dist/demo'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
})
