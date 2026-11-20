#!/usr/bin/env node
// Regenerates the landing page screenshots (site/screenshots/*.jpg) from the demo project.
// Requires a built editor (`npm run build`) and Playwright with Chromium.
//   node scripts/screenshots.mjs [--port 3399]
// The PDF page image (pdf-page.png) also needs a PDF engine and `pdftoppm` (poppler-utils).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { loadProject, readTemplate } from '../src/engine/project.js'
import { startServer } from '../src/server/server.js'
import { renderDraftPdf } from '../src/engine/pipeline.js'
import { closePdfBrowser } from '../src/engine/pdf.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'site/screenshots')
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 3399
const { chromium } = createRequire(import.meta.url)('playwright')

fs.mkdirSync(out, { recursive: true })
const project = loadProject(path.join(root, 'examples/demo'))
const server = await startServer(project, { port })
const base = `http://127.0.0.1:${port}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 })
const shot = async (name) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 82 })
  console.log(`✓ ${name}.jpg`)
}
const open = async (hash, view) => {
  await page.goto(`${base}/#${hash}`)
  await page.reload()
  await page.waitForSelector('iframe')
  await page.waitForTimeout(1200)
  // English content for the (English) landing page
  const en = page.locator('header .flags .flag[title="en-US"]')
  if (await en.count()) await en.click()
  await page.waitForTimeout(800)
  if (view) {
    await page.locator('header .seg button', { hasText: view }).first().click()
    await page.waitForTimeout(1500)
  }
}
const canvas = () => page.frameLocator('iframe')

// 1. Design view: a translatable heading selected, inspector open
await open('customers%2Femail-verification')
await page.locator('[role=treeitem]', { hasText: 'Verify your email address' }).first().click()
await shot('design')

// 2. Reusable component with parameters (inspector form)
await open('orders%2Forder-confirmation')
await canvas().locator('.tpl-comp').nth(1).click()
await shot('components')

// 3. Preview with the accessibility report
await open('orders%2Forder-confirmation', 'Preview')
await shot('accessibility')

// 4. PDF template (invoice) preview + report
await open('documents%2Finvoice', 'Preview')
await shot('pdf-template')

// 5. Code view
await open('customers%2Femail-verification', 'Code')
await shot('code')

await browser.close()
server.close()

// 6. First page of the rendered PDF (needs a PDF engine + pdftoppm)
try {
  const tpl = readTemplate(project, 'documents/invoice')
  const { pdf, engine } = await renderDraftPdf(project, { ...tpl, langKey: 'en' })
  const tmp = path.join(os.tmpdir(), 'templaitor-invoice.pdf')
  fs.writeFileSync(tmp, pdf)
  const r = spawnSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', tmp, path.join(out, 'pdf-page')])
  console.log(r.status === 0 ? `✓ pdf-page.png (${engine})` : '· pdf-page.png skipped (pdftoppm not available)')
} catch (e) {
  console.log(`· pdf-page.png skipped (${e.message})`)
} finally {
  await closePdfBrowser()
}
