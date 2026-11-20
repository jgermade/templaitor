#!/usr/bin/env node
import path from 'node:path'
import { loadProject, createTemplate } from '../src/engine/project.js'
import fs from 'node:fs'
import { readTemplate } from '../src/engine/project.js'
import { compileProject, renderDraftPdf } from '../src/engine/pipeline.js'
import { closePdfBrowser } from '../src/engine/pdf.js'

const HELP = `templaitor — plantillas MJML → HTML/TXT con Jinja2

Uso:
  templaitor compile [plantilla] [--watch]   Compila todas (o una) las plantillas a outDir
                     [--pdf]                 …y genera PDF de muestra (datos de demo) de las plantillas PDF
  templaitor pdf <plantilla> [--lang es] [--data datos.json5] [-o salida.pdf]
                                              Genera el PDF de una plantilla PDF
  templaitor editor [--port 3333] [--open]    Abre el editor visual
  templaitor new <grupo/nombre> [--layout x]  Crea una plantilla nueva

Opciones globales:
  --cwd <dir>     Directorio del proyecto (donde está templaitor.config.yml)
`

const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return def
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BOOL_FLAGS = ['--watch', '--open', '--pdf', '--strict']
const positional = args.filter((a, i) => !a.startsWith('-') && !(i > 0 && args[i - 1].startsWith('-') && !BOOL_FLAGS.includes(args[i - 1])))
const [cmd, target] = positional
const cwd = path.resolve(flag('cwd', process.cwd()))

async function main() {
  const project = loadProject(cwd)

  if (cmd === 'compile') {
    const run = async () => {
      const { files, issues } = await compileProject(project, { target, samplePdf: !!flag('pdf') })
      console.log(`\n${files.length} fichero(s) en ${path.relative(process.cwd(), project.outDir) || '.'}` +
        (issues.length ? ` · ${issues.length} aviso(s)` : ''))
      return issues
    }
    const issues = await run()
    if (!flag('watch')) await closePdfBrowser()
    if (flag('watch')) {
      const { default: chokidar } = await import('chokidar')
      console.log('\n[watch] Esperando cambios...')
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
    if (!target) throw new Error('Indica la plantilla: templaitor pdf grupo/nombre')
    const tpl = readTemplate(project, target)
    const dataFile = flag('data')
    const data = typeof dataFile === 'string' ? fs.readFileSync(path.resolve(dataFile), 'utf8') : tpl.data
    const lang = typeof flag('lang') === 'string' ? flag('lang') : undefined
    const { pdf, result } = await renderDraftPdf(project, { mjml: tpl.mjml, yml: tpl.yml, data, langKey: lang })
    const iOut = args.indexOf('-o')
    const out = path.resolve(iOut !== -1 ? args[iOut + 1] : `${tpl.name}.${result.locale}.pdf`)
    fs.writeFileSync(out, pdf)
    for (const w of result.warnings) console.warn(`  [warn] ${w}`)
    console.log(`✓ ${path.relative(process.cwd(), out)} (${Math.round(pdf.length / 1024)} KB)`)
    await closePdfBrowser()
    return
  }

  if (cmd === 'editor') {
    const { startServer } = await import('../src/server/server.js')
    await startServer(project, { port: Number(flag('port', process.env.PORT || 3333)), open: !!flag('open') })
    return
  }

  if (cmd === 'new') {
    if (!target) throw new Error('Indica el id: templaitor new grupo/nombre')
    const t = createTemplate(project, target, { layout: flag('layout') === true ? undefined : flag('layout') })
    console.log(`✓ Plantilla creada: ${t.id}`)
    return
  }

  console.log(HELP)
  if (cmd && cmd !== 'help') process.exit(1)
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
