#!/usr/bin/env node
// Builds the GitHub Pages site into dist/site: the landing page, its screenshots and the brand assets, the API
// reference (/api/) and the in-browser editor demo (/demo/, built first with `npm run build:demo`).
//   npm run build:demo && node scripts/build-site.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist/site')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(path.join(root, 'site'), out, { recursive: true })
fs.mkdirSync(path.join(out, 'assets'), { recursive: true })
for (const f of ['logo.svg', 'favicon.svg', 'logo-512.png']) {
  fs.copyFileSync(path.join(root, 'assets/brand', f), path.join(out, 'assets', f))
}

// version in the footers
const stamp = (file, text) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<span id="version">[^<]*<\/span>/, `<span id="version">${text}</span>`))
stamp(path.join(out, 'index.html'), `v${version} · MJML → Jinja2 · accessible emails and PDFs`)
stamp(path.join(out, 'api/index.html'), `templaitor v${version} API`)

// editor demo (the engine in the browser): dist/demo
const demo = path.join(root, 'dist/demo')
if (fs.existsSync(path.join(demo, 'index.html'))) fs.cpSync(demo, path.join(out, 'demo'), { recursive: true })
else if (process.argv.includes('--strict')) throw new Error('dist/demo is missing: run `npm run build:demo` first')
else console.warn('! dist/demo is missing (npm run build:demo): the site has no /demo/')
// GitHub Pages: serve files as-is (no Jekyll processing)
fs.writeFileSync(path.join(out, '.nojekyll'), '')

console.log(`✓ dist/site (v${version})`)
