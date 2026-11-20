#!/usr/bin/env node
// Builds the GitHub Pages site into dist/site: the landing page, its screenshots and the brand assets.
//   node scripts/build-site.mjs

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

// version in the footer
const index = path.join(out, 'index.html')
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(
  /<span id="version">[^<]*<\/span>/,
  `<span id="version">v${version} · MJML → Jinja2 · accessible emails and PDFs</span>`,
))
// GitHub Pages: serve files as-is (no Jekyll processing)
fs.writeFileSync(path.join(out, '.nojekyll'), '')

console.log(`✓ dist/site (v${version})`)
