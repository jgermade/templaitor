#!/usr/bin/env node
import path from 'node:path'
import { loadProject, createTemplate } from '../src/engine/project.js'
import fs from 'node:fs'
import { readTemplate } from '../src/engine/project.js'
import { compileProject, renderDraftPdf } from '../src/engine/pipeline.js'
import { closePdfBrowser, listEngines, resolveEngine } from '../src/engine/pdf.js'
import { validatePdf, verapdfRunner } from '../src/engine/verapdf.js'

const HELP = `templaitor — MJML templates → HTML/TXT with Jinja2, and PDF documents

Usage:
  templaitor compile [template] [--watch]    Compile all templates (or one) to outDir
                     [--pdf] [--validate]    …also render sample PDFs (demo data) and validate them
  templaitor pdf <template> [--lang es] [--data data.json5] [-o out.pdf] [--engine weasyprint] [--validate]
                                              Render a PDF template (and validate it with veraPDF)
  templaitor validate <file.pdf> [--flavour ua1]
                                              Validate a PDF with veraPDF (PDF/UA-1 by default)
  templaitor engines                          Available PDF engines and validator
  templaitor editor [--port 3333] [--open]    Open the visual editor
  templaitor new <group/name> [--layout x]    Create a new template
  templaitor versions <template> [--kind component|layout]
                                              List the versions of a document (git)
  templaitor versions export [--out file]     Export every version from git to .templaitor/versions.json
                                              (deployments without .git keep their history)
  templaitor serve [--config templaitor.server.yml] [--port 3000]
                                              Hosted service: users, organizations, editor and send API
                                              (Node ≥ 22.13; see "Hosted service" in the README)
  templaitor version                          Print the version (also --version, -v)

Global options:
  --cwd <dir>     Project directory (where templaitor.config.yml lives)
`

const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return def
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BOOL_FLAGS = ['--watch', '--open', '--pdf', '--strict', '--validate']
const positional = args.filter((a, i) => !a.startsWith('-') && !(i > 0 && args[i - 1].startsWith('-') && !BOOL_FLAGS.includes(args[i - 1])))
const [cmd, target] = positional
const cwd = path.resolve(flag('cwd', process.cwd()))

async function main() {
  if (cmd === 'version' || args[0] === '--version' || args[0] === '-v') {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    console.log(pkg.version)
    return
  }

  if (cmd === 'serve') {
    const { serve } = await import('../src/service/serve.js')
    const file = flag('config')
    await serve({ cwd, file: typeof file === 'string' ? file : undefined, port: typeof flag('port') === 'string' ? flag('port') : undefined })
    return
  }

  const project = loadProject(cwd)

  if (cmd === 'versions') {
    // templaitor versions export [--out file]  ·  templaitor versions <template> [--kind component|layout]
    if (target === 'export') {
      const { exportVersions } = await import('../src/engine/snapshot.js')
      const out = flag('out')
      const r = await exportVersions(project, { file: typeof out === 'string' ? path.resolve(out) : undefined, log: console.log })
      console.log(`\n✓ ${r.versions} version(s) of ${r.documents} document(s) → ${path.relative(process.cwd(), r.file)}`)
      return
    }
    if (!target) throw new Error('Usage: templaitor versions <template> | templaitor versions export [--out file]')
    const { listVersions } = await import('../src/engine/versions.js')
    const kind = typeof flag('kind') === 'string' ? flag('kind') : 'template'
    const r = await listVersions(project, target, kind, { limit: 200 })
    if (!r.available) throw new Error(r.reason || 'Versions are not available')
    for (const v of r.versions) console.log(`v${v.number}\t${v.short}\t${v.date.slice(0, 10)}\t${v.author}\t${v.message}`)
    if (r.dirty) console.log('(the saved files have changes that are not in a version)')
    return
  }

  if (cmd === 'compile') {
    const run = async () => {
      const { files, issues } = await compileProject(project, { target, samplePdf: !!flag('pdf') || !!flag('validate'), validate: !!flag('validate') })
      console.log(`\n${files.length} file(s) in ${path.relative(process.cwd(), project.outDir) || '.'}` +
        (issues.length ? ` · ${issues.length} warning(s)` : ''))
      return issues
    }
    const issues = await run()
    if (!flag('watch')) await closePdfBrowser()
    if (flag('watch')) {
      const { default: chokidar } = await import('chokidar')
      console.log('\n[watch] Waiting for changes...')
      chokidar.watch(project.templatesDir, { ignoreInitial: true }).on('all', (_, file) => {
        console.log(`\n[watch] ${path.relative(project.templatesDir, file)}`)
        run().catch(console.error)
      })
    } else if (flag('strict') && issues.length) {
      process.exit(1)
    }
    return
  }

  if (cmd === 'pdf') {
    if (!target) throw new Error('Missing template: templaitor pdf group/name')
    const tpl = readTemplate(project, target)
    const dataFile = flag('data')
    const data = typeof dataFile === 'string' ? fs.readFileSync(path.resolve(dataFile), 'utf8') : tpl.data
    const lang = typeof flag('lang') === 'string' ? flag('lang') : undefined
    const engine = typeof flag('engine') === 'string' ? flag('engine') : undefined
    const { pdf, result, engine: used } = await renderDraftPdf(project, { mjml: tpl.mjml, yml: tpl.yml, data, langKey: lang }, { engine })
    const iOut = args.indexOf('-o')
    const out = path.resolve(iOut !== -1 ? args[iOut + 1] : `${tpl.name}.${result.locale}.pdf`)
    fs.writeFileSync(out, pdf)
    for (const w of result.warnings) console.warn(`  [warn] ${w}`)
    console.log(`✓ ${path.relative(process.cwd(), out)} (${Math.round(pdf.length / 1024)} KB · ${used})`)
    await closePdfBrowser()
    if (flag('validate')) process.exitCode = printValidation(await validatePdf(pdf)) ? 0 : 1
    return
  }

  if (cmd === 'validate') {
    if (!target) throw new Error('Missing PDF: templaitor validate file.pdf')
    const flavour = typeof flag('flavour') === 'string' ? flag('flavour') : 'ua1'
    process.exitCode = printValidation(await validatePdf(fs.readFileSync(path.resolve(target)), { flavour })) ? 0 : 1
    return
  }

  if (cmd === 'engines') {
    let def = '—'
    try { def = resolveEngine(project.config.pdf?.engine) } catch {}
    console.log('PDF engines (in order of preference for accessibility):')
    for (const e of listEngines()) {
      console.log(`  ${e.available ? '✓' : '·'} ${e.id.padEnd(11)} ${e.label.padEnd(22)} ${e.pdfua ? 'PDF/UA-1' : 'no PDF/UA'}  ${e.license}${e.available ? '' : `  → ${e.install}`}`)
    }
    console.log(`  Default: ${def}${project.config.pdf?.engine ? ` (config: ${project.config.pdf.engine})` : ' (auto)'}`)
    const v = verapdfRunner()
    console.log(`Validator: ${v ? `✓ ${v.label}` : '· veraPDF not available (make verapdf)'}`)
    return
  }

  if (cmd === 'editor') {
    const { startServer } = await import('../src/server/server.js')
    await startServer(project, { port: Number(flag('port', process.env.PORT || 3333)), open: !!flag('open') })
    return
  }

  if (cmd === 'new') {
    if (!target) throw new Error('Missing id: templaitor new group/name')
    const t = createTemplate(project, target, { layout: flag('layout') === true ? undefined : flag('layout') })
    console.log(`✓ Template created: ${t.id}`)
    return
  }

  console.log(HELP)
  if (cmd && cmd !== 'help') process.exit(1)
}

function printValidation(v) {
  console.log(`${v.compliant ? '✓ Compliant' : '✕ Not compliant'} ${v.profile} — ${v.passedRules} rules ✓ · ${v.failedRules} ✕ (${v.validator})`)
  for (const r of v.rules) console.log(`  ✕ ${r.id} (${r.checks}×) ${r.hint || r.description}`)
  return v.compliant
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
