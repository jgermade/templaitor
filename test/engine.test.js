import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, serialize, findNode, moveNode, splitFrontmatter } from '../src/shared/mjml-tree.js'
import { resolveCommands } from '../src/engine/commands.js'
import { obfuscate, restore } from '../src/engine/guard.js'
import { annotateBody, chipify } from '../src/engine/design.js'
import { loadProject, readTemplate, createTemplate, listTemplates, listComponents, readLinks } from '../src/engine/project.js'
import { compileProject, previewDraft, compileSource } from '../src/engine/pipeline.js'
import { findImportCalls, parseImportCall, formatImportCall, applyParams } from '../src/shared/imports.js'
import YAML from 'yaml'

const DEMO = path.resolve(import.meta.dirname, '../examples/demo')

test('parser: round-trip conserva comandos, Jinja2 y contenido', () => {
  const src = `<mj-section padding="0">
  <mj-column>
    <mj-text color="#111">$t('title') <b>{{ name }}</b></mj-text>
    <mj-button href="{{ url }}?a=1&b=2">Go</mj-button>
  </mj-column>
</mj-section>
<mj-raw>{% if x %}</mj-raw>
$import(_partials/footer.mjml)
<!-- nota -->
`
  const tree = parse(src)
  const out = serialize(tree)
  assert.deepEqual(stripIds(parse(out)), stripIds(tree))
  assert.match(out, /\$import\(_partials\/footer\.mjml\)/)
  assert.match(out, /href="\{\{ url \}\}\?a=1&b=2"/)
  assert.equal(findNode(tree, '0.0.0').content, "$t('title') <b>{{ name }}</b>")
  assert.equal(tree.children[1].tag, 'mj-raw')
  assert.equal(tree.children[2].type, 'text')
  assert.equal(tree.children[3].type, 'comment')
})

test('parser: moveNode reasigna ids', () => {
  const tree = parse('<mj-section><mj-column><mj-text>a</mj-text><mj-text>b</mj-text></mj-column></mj-section>')
  moveNode(tree, '0.0.1', '0.0', 0)
  assert.equal(findNode(tree, '0.0.0').content, 'b')
  assert.equal(findNode(tree, '0.0.1').id, '0.0.1')
})

test('frontmatter', () => {
  const { frontmatter, body } = splitFrontmatter('---\nlayout: a.mjml\n---\n<mj-section />')
  assert.equal(frontmatter, 'layout: a.mjml')
  assert.equal(body, '<mj-section />')
})

test('comandos $: t, link, if, lang, recursivos', () => {
  const ctx = {
    lang: 'es-ES', country: 'ES', warnings: [],
    messages: { a: "Hola $t('b')", b: 'mundo', nested: { k: 'anidado' } },
    links: { home: 'https://x.y' },
  }
  assert.equal(resolveCommands("$t('a')", ctx), 'Hola mundo')
  assert.equal(resolveCommands("$t('nested.k')", ctx), 'anidado')
  assert.equal(resolveCommands('$link{ home, label: Inicio }', ctx), '<a href="https://x.y">Inicio</a>')
  assert.equal(resolveCommands("$if($lang === 'es-ES')sí$else no$end", ctx), 'sí')
  assert.equal(resolveCommands("$t('nope')", ctx), '')
  assert.equal(ctx.warnings.length, 1)
})

test('guard: protege {{ }}, {% %} y {# #}', () => {
  const src = '<a href="{{ u }}">{% if a %}x{# c #}{% endif %}</a>'
  const { content, map } = obfuscate(src)
  assert.doesNotMatch(content, /[{}]/)
  assert.equal(restore(content, map), src)
})

test('modo diseño: anota nodos y crea regiones editables con chips', () => {
  const out = annotateBody("<mj-section><mj-column><mj-text>$t('hi')</mj-text><mj-text>Hola {{ n }}</mj-text></mj-column></mj-section>", {
    messages: { hi: 'Hola {{ name }}' },
  })
  assert.match(out, /css-class="tpl-node tpl-node--0"/)
  assert.match(out, /data-tpl-edit="t:hi"/)
  assert.match(out, /data-tpl-edit="c:0\.0\.1"/)
  assert.doesNotMatch(out.replace(/data-tpl-src="[^"]*"/g, ''), /\{\{/)
  assert.match(chipify('{{ a }}'), /tpl-chip--var/)
})

test('compilación del proyecto demo: Jinja2 intacto en HTML/TXT/subject', async () => {
  const project = loadProject(DEMO, { outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-')) })
  const { files, issues } = await compileProject(project, { log: null })
  assert.equal(issues.length, 0, JSON.stringify(issues))
  assert.equal(files.length, listTemplates(project).length * 2 * 3)
  const base = path.join(project.outDir, 'orders/order-confirmation/order-confirmation.es-ES')
  const html = fs.readFileSync(`${base}.html`, 'utf8')
  assert.match(html, /\{% for item in items %\}/)
  assert.match(html, /href="\{\{ tracking_url \}\}"/)
  assert.match(html, /lang="es-ES"/)
  const txt = fs.readFileSync(`${base}.txt`, 'utf8')
  for (const tok of txt.match(/\{\{[\s\S]*?\}\}/g)) assert.doesNotMatch(tok, /\n/, 'el wordwrap no debe partir tokens')
  assert.equal(fs.readFileSync(`${base}.subject.txt`, 'utf8'), 'Pedido #{{ order_id }} confirmado')
})

test('vista previa: renderiza con datos de demo', async () => {
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const r = await previewDraft(project, { ...tpl, langKey: 'en' })
  assert.equal(r.subject, 'Order #A-1042 confirmed')
  assert.match(r.html, /Teclado mecánico/)
  assert.deepEqual(r.warnings, [])
})

test('createTemplate: genera una plantilla que compila', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'))
  fs.writeFileSync(path.join(dir, 'templaitor.config.yml'), 'locales:\n  es: es-ES\n  en: en-US\n')
  const project = loadProject(dir)
  createTemplate(project, 'misc/hello')
  assert.throws(() => createTemplate(project, '../evil'), /no válido/)
  const { issues } = await compileProject(project, { log: null })
  assert.equal(issues.length, 0)
  assert.ok(fs.existsSync(path.join(dir, 'dist/misc/hello/hello.en-US.html')))
})

function stripIds(node) {
  const { id, ...rest } = node
  if (rest.children) rest.children = rest.children.map(stripIds)
  return rest
}

test('componentes: $import de carpeta, textos propios y sobrescritura desde la plantilla', async () => {
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'customers/email-verification')
  const r = await previewDraft(project, { ...tpl, langKey: 'en' })
  assert.match(r.text, /The Acme team/)
  assert.match(r.text, /Help \[/)
  const yml = tpl.yml.replace("  en:\n", "  en:\n    signature: Cheers\n")
  const r2 = await previewDraft(project, { ...tpl, yml, langKey: 'en' })
  assert.match(r2.text, /Cheers/)
  assert.doesNotMatch(r2.text, /The Acme team/)
})

test('componentes: listado con usos y modo diseño selecciona la instancia entera', async () => {
  const project = loadProject(DEMO)
  const comps = Object.fromEntries(listComponents(project).map(c => [c.id, c]))
  assert.deepEqual(comps.signature.usedBy.map(u => u.id).sort(), ['customers/email-verification', 'orders/order-confirmation'])
  assert.equal(comps.footer.usedBy[0].kind, 'layout')
  const tpl = readTemplate(project, 'customers/email-verification')
  const d = await previewDraft(project, { ...tpl, langKey: 'es', mode: 'design' })
  assert.equal((d.html.match(/tpl-comp tpl-node--\d+"/g) || []).length, 3)
  const c = readTemplate(project, 'legal-notice', 'component')
  const cp = await previewDraft(project, { ...c, kind: 'component' })
  assert.deepEqual(cp.errors, [])
  assert.match(cp.html, /Inter/, 'usa el <mj-head> del layout')
})

test('imports: parámetros con comillas, comas y paréntesis', () => {
  const t = `x $import(_components/cta, url="{{ a }}/v?x=1,y", label="$t('cta')", note='di "hola"') y`
  const [call] = findImportCalls(t)
  assert.equal(call.path, '_components/cta')
  assert.deepEqual(call.params, [['url', '{{ a }}/v?x=1,y'], ['label', "$t('cta')"], ['note', 'di "hola"']])
  assert.deepEqual(parseImportCall(formatImportCall(call.path, call.params)).params, call.params)
  assert.equal(applyParams('$param.a|$param.b|$param.c', { a: 'A', b: { default: 'B' } }, [['b', 'X']]), 'A|X|')
  // el parser trata cada $import (aunque lleve paréntesis en los argumentos) como un nodo
  const tree = parse(`<mj-section />\n${t.slice(2, -2)}\n<mj-section />`)
  assert.equal(tree.children[1].value, t.slice(2, -2))
})

test('componentes con parámetros: valores por instancia, por defecto y Jinja2 intacto', async () => {
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const r = await compileSource(project, { mjml: tpl.mjml, i18n: YAML.parse(tpl.yml), links: readLinks(project), langKey: 'es' })
  assert.match(r.html, /href="\{\{ tracking_url \}\}"/)
  assert.match(r.html, /background:#059669/)
  assert.match(r.html, /Seguir envío/)
  assert.deepEqual(r.warnings, [])
  const c = readTemplate(project, 'cta-button', 'component')
  const cp = await previewDraft(project, { ...c, kind: 'component', langKey: 'es' })
  assert.match(cp.html, /Continuar/)
  assert.match(cp.html, /background:#4F46E5/)
  const comps = Object.fromEntries(listComponents(project).map(x => [x.id, x]))
  assert.equal(comps['cta-button'].params.align.type, 'select')
  assert.equal(comps['cta-button'].usedBy.length, 2)
})

test('parámetros image y boolean', async () => {
  assert.equal(applyParams('$if($param.show)S$end', { show: { type: 'boolean', default: true } }, [['show', 'no']]), '$if(false)S$end')
  assert.equal(applyParams('$param.show', { show: { type: 'boolean', default: 'yes' } }), 'true')
  const warnings = []
  assert.equal(applyParams('$param.show', { show: { type: 'boolean' } }, [['show', 'quizá']], w => warnings.push(w)), 'false')
  assert.equal(warnings.length, 1)
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const withCaption = await previewDraft(project, { ...tpl, langKey: 'es' })
  assert.match(withCaption.text, /Tu pedido ya está en preparación/)
  assert.match(withCaption.html, /src="\/static\/banner-order\.svg"/)
  const without = await previewDraft(project, { ...tpl, mjml: tpl.mjml.replace('show_caption="true"', 'show_caption="false"'), langKey: 'es' })
  assert.doesNotMatch(without.text, /Tu pedido ya está en preparación/)
  const raw = await compileSource(project, { mjml: tpl.mjml, i18n: YAML.parse(tpl.yml), links: readLinks(project), langKey: 'es' })
  assert.match(raw.html, /src="\{\{ assets_url \}\}\/banner-order\.svg"/, 'la URL de la imagen conserva el Jinja2')
})
