#!/usr/bin/env node
// Pre-generates the PDFs of the editor demo (GitHub Pages /demo/), which cannot render PDFs in the browser:
// every PDF template of examples/demo in every language, and every PDF attachment of its emails, rendered
// with their demo data. Also validates them with veraPDF (PDF/UA-1) when it is available.
//   node scripts/build-demo-pdfs.mjs [--out dist/demo/pdfs] [--engine weasyprint] [--strict]
// Writes <out>/manifest.json; the demo backend (editor/demo/backend.js) serves a PDF when the draft is the
// one it was made from (sha256 of its mjml, yml and data), and the starter's PDF with a note otherwise.
// --strict: fail when no PDF engine is available (CI); otherwise it warns and writes nothing.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { loadProject, listTemplates, readTemplate } from '../src/engine/project.js'
import { renderDraftPdf, renderDraftAttachments, previewDraft, langsOf } from '../src/engine/pipeline.js'
import { resolveEngine, PDF_ENGINES } from '../src/engine/pdf.js'
import { validatePdf, verapdfRunner } from '../src/engine/verapdf.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def }
const strict = process.argv.includes('--strict')
const out = path.resolve(root, arg('out', 'dist/demo/pdfs'))

/** Same fingerprint as editor/demo/backend.js */
export const draftHash = (d) => crypto.createHash('sha256').update(JSON.stringify([d.mjml ?? '', d.yml ?? '', d.data ?? ''])).digest('hex')

let engine
try {
  engine = resolveEngine(arg('engine', process.env.TEMPLAITOR_PDF_ENGINE || 'auto'))
} catch (e) {
  if (strict) throw e
  console.warn(`! demo PDFs skipped: ${e.message}`)
  process.exit(0)
}
process.env.TEMPLAITOR_PDF_ENGINE = engine // the attachments' PDFs too
const veraPdf = verapdfRunner()
const project = loadProject(path.join(root, 'examples/demo'))

fs.rmSync(out, { recursive: true, force: true })
const manifest = {
  format: 1, generatedAt: new Date().toISOString(),
  engine, engineLabel: PDF_ENGINES[engine].label, pdfua: !!PDF_ENGINES[engine].pdfua,
  validator: veraPdf ? veraPdf.label : null,
  documents: {}, attachments: {},
}
const write = (rel, buf) => {
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true })
  fs.writeFileSync(path.join(out, rel), buf)
  return rel
}
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_')
let count = 0

for (const t of listTemplates(project)) {
  const tpl = readTemplate(project, t.id)
  const langs = langsOf(project, YAML.parse(tpl.yml || '') || {})
  const hash = draftHash(tpl)
  if (t.format === 'pdf') {
    const entry = manifest.documents[t.id] = { name: tpl.name, hash, langs: {} }
    for (const lang of langs) {
      const { pdf, engine: used, result } = await renderDraftPdf(project, { mjml: tpl.mjml, yml: tpl.yml, data: tpl.data, langKey: lang }, { engine })
      const file = write(`${t.id}/${result.locale}.pdf`, pdf)
      const validation = veraPdf ? await validatePdf(pdf, { flavour: 'ua1' }).catch(e => ({ error: e.message })) : null
      entry.langs[lang] = { file, locale: result.locale, engine: used, validation }
      count++
      console.log(`  ${file}${validation ? ` · ${validation.compliant ? 'PDF/UA-1 compliant' : 'NOT compliant'}` : ''}`)
    }
    continue
  }
  // PDF attachments of emails (rendered with the email's demo data, as the editor does)
  for (const lang of langs) {
    const draft = { mjml: tpl.mjml, yml: tpl.yml, data: tpl.data, langKey: lang }
    const r = await previewDraft(project, draft)
    const list = []
    for (const a of (r.attachments || []).filter(x => x.type === 'template')) {
      const [att] = await renderDraftAttachments(project, draft, { index: a.index })
      list.push({ index: a.index, template: a.template, locale: a.locale, filename: att.filename, contentType: att.contentType, file: write(`${t.id}/attachments/${r.locale}.${a.index}.${safe(att.filename)}`, att.content) })
      count++
      console.log(`  ${list.at(-1).file}`)
    }
    if (list.length) (manifest.attachments[t.id] ??= { hash, langs: {} }).langs[lang] = list
  }
}

write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`✓ ${path.relative(root, out)}: ${count} file(s) with ${manifest.engineLabel}${veraPdf ? `, validated with ${veraPdf.label}` : ''}`)
