import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, serialize, findNode, moveNode, splitFrontmatter } from '../src/shared/mjml-tree.js'
import { resolveCommands } from '../src/engine/commands.js'
import { obfuscate, restore } from '../src/engine/guard.js'
import { annotateBody, chipify } from '../src/engine/design.js'
import { loadProject, readTemplate, createTemplate, listTemplates, listComponents, readLinks, listLayouts, readLayout, writeLayout } from '../src/engine/project.js'
import { compileProject, previewDraft, compileSource, renderDraftAttachments } from '../src/engine/pipeline.js'
import { normalizeAttachments } from '../src/shared/attachments.js'
import { renderAttachment, attachmentData } from '../src/engine/attachments.js'
import { listEngines } from '../src/engine/pdf.js'
import { findImportCalls, parseImportCall, formatImportCall, applyParams } from '../src/shared/imports.js'
import { accessibilityReport, contrast, parseColor } from '../src/engine/a11y.js'
import { pdfOptions, contentWidthPx, marginBoxContent } from '../src/engine/pdf.js'
import { setHeadingLevel, headingLevel, rewrap } from '../src/shared/semantics.js'
import YAML from 'yaml'

const DEMO = path.resolve(import.meta.dirname, '../examples/demo')

test('parser: round-trip keeps commands, Jinja2 and content', () => {
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

test('parser: moveNode reassigns ids', () => {
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

test('$ commands: t, link, if, lang, recursive', () => {
  const ctx = {
    lang: 'es-ES', country: 'ES', warnings: [],
    messages: { a: "Hello $t('b')", b: 'world', nested: { k: 'nested' } },
    links: { home: 'https://x.y' },
  }
  assert.equal(resolveCommands("$t('a')", ctx), 'Hello world')
  assert.equal(resolveCommands("$t('nested.k')", ctx), 'nested')
  assert.equal(resolveCommands('$link{ home, label: Inicio }', ctx), '<a href="https://x.y">Inicio</a>')
  assert.equal(resolveCommands("$if($lang === 'es-ES')yes$else no$end", ctx), 'yes')
  assert.equal(resolveCommands("$t('nope')", ctx), '')
  assert.equal(ctx.warnings.length, 1)
})

test('guard: protects {{ }}, {% %} and {# #}', () => {
  const src = '<a href="{{ u }}">{% if a %}x{# c #}{% endif %}</a>'
  const { content, map } = obfuscate(src)
  assert.doesNotMatch(content, /[{}]/)
  assert.equal(restore(content, map), src)
})

test('design mode: annotates nodes and creates editable regions with chips', () => {
  const out = annotateBody("<mj-section><mj-column><mj-text>$t('hi')</mj-text><mj-text>Hola {{ n }}</mj-text></mj-column></mj-section>", {
    messages: { hi: 'Hello {{ name }}' },
  })
  assert.match(out, /css-class="tpl-node tpl-node--0"/)
  assert.match(out, /data-tpl-edit="t:hi"/)
  assert.match(out, /data-tpl-edit="c:0\.0\.1"/)
  assert.doesNotMatch(out.replace(/data-tpl-src="[^"]*"/g, ''), /\{\{/)
  assert.match(chipify('{{ a }}'), /tpl-chip--var/)
})

test('demo project compilation: Jinja2 intact in HTML/TXT/subject', async () => {
  const project = loadProject(DEMO, { outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-')) })
  const { files, issues } = await compileProject(project, { log: null })
  assert.equal(issues.length, 0, JSON.stringify(issues))
  // emails: .html/.txt/.subject.txt · PDF: .html/.pdf.json (per language)
  // (+ .attachments.json per language for emails with attachments)
  const expected = listTemplates(project).reduce((n, t) => n + 2 * (t.id.startsWith('documents/') ? 2 : 3), 0) + 2
  assert.equal(files.length, expected)
  const base = path.join(project.outDir, 'orders/order-confirmation/order-confirmation.es-ES')
  const html = fs.readFileSync(`${base}.html`, 'utf8')
  assert.match(html, /\{% for item in items %\}/)
  assert.match(html, /href="\{\{ tracking_url \}\}"/)
  assert.match(html, /lang="es-ES"/)
  const txt = fs.readFileSync(`${base}.txt`, 'utf8')
  for (const tok of txt.match(/\{\{[\s\S]*?\}\}/g)) assert.doesNotMatch(tok, /\n/, 'word-wrap must not split tokens')
  assert.equal(fs.readFileSync(`${base}.subject.txt`, 'utf8'), 'Pedido #{{ order_id }} confirmado')
})

test('preview: renders with demo data', async () => {
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const r = await previewDraft(project, { ...tpl, langKey: 'en' })
  assert.equal(r.subject, 'Order #A-1042 confirmed')
  assert.match(r.html, /Mechanical keyboard/)
  assert.deepEqual(r.warnings, [])
})

test('createTemplate: creates a template that compiles', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'))
  fs.writeFileSync(path.join(dir, 'templaitor.config.yml'), 'locales:\n  es: es-ES\n  en: en-US\n')
  const project = loadProject(dir)
  createTemplate(project, 'misc/hello')
  assert.throws(() => createTemplate(project, '../evil'), /Invalid template id/)
  const { issues } = await compileProject(project, { log: null })
  assert.equal(issues.length, 0)
  assert.ok(fs.existsSync(path.join(dir, 'dist/misc/hello/hello.en-US.html')))
})

function stripIds(node) {
  const { id, ...rest } = node
  if (rest.children) rest.children = rest.children.map(stripIds)
  return rest
}

test('components: folder $import, own texts and overrides from the template', async () => {
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

test('components: listing with usages, and design mode selects the whole instance', async () => {
  const project = loadProject(DEMO)
  const comps = Object.fromEntries(listComponents(project).map(c => [c.id, c]))
  assert.deepEqual(comps.signature.usedBy.map(u => u.id).sort(), ['customers/email-verification', 'documents/invoice', 'orders/order-confirmation'])
  assert.equal(comps.footer.usedBy[0].kind, 'layout')
  const tpl = readTemplate(project, 'customers/email-verification')
  const d = await previewDraft(project, { ...tpl, langKey: 'es', mode: 'design' })
  assert.equal((d.html.match(/tpl-comp tpl-node--\d+"/g) || []).length, 3)
  const c = readTemplate(project, 'legal-notice', 'component')
  const cp = await previewDraft(project, { ...c, kind: 'component' })
  assert.deepEqual(cp.errors, [])
  assert.match(cp.html, /Inter/, 'uses the layout <mj-head>')
})

test('imports: parameters with quotes, commas and parentheses', () => {
  const t = `x $import(_components/cta, url="{{ a }}/v?x=1,y", label="$t('cta')", note='di "hola"') y`
  const [call] = findImportCalls(t)
  assert.equal(call.path, '_components/cta')
  assert.deepEqual(call.params, [['url', '{{ a }}/v?x=1,y'], ['label', "$t('cta')"], ['note', 'di "hola"']])
  assert.deepEqual(parseImportCall(formatImportCall(call.path, call.params)).params, call.params)
  assert.equal(applyParams('$param.a|$param.b|$param.c', { a: 'A', b: { default: 'B' } }, [['b', 'X']]), 'A|X|')
  // the parser treats every $import (even with parentheses in its arguments) as one node
  const tree = parse(`<mj-section />\n${t.slice(2, -2)}\n<mj-section />`)
  assert.equal(tree.children[1].value, t.slice(2, -2))
})

test('components with parameters: per-instance values, defaults and intact Jinja2', async () => {
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const r = await compileSource(project, { mjml: tpl.mjml, i18n: YAML.parse(tpl.yml), links: readLinks(project), langKey: 'es' })
  assert.match(r.html, /href="\{\{ tracking_url \}\}"/)
  assert.match(r.html, /background:#047857/)
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

test('image and boolean parameters', async () => {
  assert.equal(applyParams('$if($param.show)S$end', { show: { type: 'boolean', default: true } }, [['show', 'no']]), '$if(false)S$end')
  assert.equal(applyParams('$param.show', { show: { type: 'boolean', default: 'yes' } }), 'true')
  const warnings = []
  assert.equal(applyParams('$param.show', { show: { type: 'boolean' } }, [['show', 'maybe']], w => warnings.push(w)), 'false')
  assert.equal(warnings.length, 1)
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const withCaption = await previewDraft(project, { ...tpl, langKey: 'es' })
  assert.match(withCaption.text, /Tu pedido ya está en preparación/)
  assert.match(withCaption.html, /src="\/static\/banner-order\.svg"/)
  const without = await previewDraft(project, { ...tpl, mjml: tpl.mjml.replace('show_caption="true"', 'show_caption="false"'), langKey: 'es' })
  assert.doesNotMatch(without.text, /Tu pedido ya está en preparación/)
  const raw = await compileSource(project, { mjml: tpl.mjml, i18n: YAML.parse(tpl.yml), links: readLinks(project), langKey: 'es' })
  assert.match(raw.html, /src="\{\{ assets_url \}\}\/banner-order\.svg"/, 'the image URL keeps its Jinja2')
})

test('layouts: listing with usages, preview with a slot and non-editable texts', async () => {
  const project = loadProject(DEMO)
  const [base] = listLayouts(project)
  assert.equal(base.id, 'base.layout.mjml')
  assert.equal(base.usedBy.length, 2)
  const doc = readLayout(project, base.id)
  assert.equal(doc.previewFrom, base.usedBy[0].id)
  const d = await previewDraft(project, { ...doc, kind: 'layout', mode: 'design' })
  assert.deepEqual(d.errors, [])
  assert.match(d.html, /Template content/)
  assert.doesNotMatch(d.html, /data-tpl-edit="t:/)
  assert.throws(() => writeLayout(project, base.id, { mjml: '<mjml><mj-body></mj-body></mjml>' }), /\$content/)
  assert.throws(() => readLayout(project, '../x.mjml'), /Invalid layout/)
})

test('accessibility: detects issues and the demo meets WCAG 2.1 AA', async () => {
  const bad = `<!doctype html><html lang="und"><head><title></title></head><body style="background-color:#f4f4f5">
    <div style="color:#9ca3af;font-size:11px">Grey text</div><img src="x.png"><a href="/x">aquí</a><a href="/y"><img src="y.png" alt=""></a>
    <table><tr><td>a</td><td>b</td></tr></table></body></html>`
  const rules = accessibilityReport(bad).issues.map(i => i.rule)
  for (const r of ['lang', 'title', 'headings', 'img-alt', 'link-vague', 'link-name', 'table-headers', 'contrast', 'font-size']) {
    assert.ok(rules.includes(r), `should detect ${r}`)
  }
  assert.equal(Math.round(contrast(parseColor('#ffffff'), parseColor('#000')) * 10) / 10, 21)
  const project = loadProject(DEMO)
  for (const t of listTemplates(project)) {
    const tpl = readTemplate(project, t.id)
    for (const lang of t.langs) {
      const r = await previewDraft(project, { ...tpl, langKey: lang })
      assert.deepEqual(r.a11y, [], `${t.id} (${lang}) does not comply: ${r.a11y.map(i => i.message).join('; ')}`)
    }
  }
})

test('semantics: headings inherit the style and can be removed', () => {
  const h = setHeadingLevel("$t('title')", 1)
  assert.match(h, /^<h1 style="margin:0;font:inherit/)
  assert.equal(headingLevel(h), 1)
  assert.equal(headingLevel(setHeadingLevel(h, 2)), 2)
  assert.equal(setHeadingLevel(h, 0), "$t('title')")
  assert.equal(rewrap(h, 'Hello'), h.replace("$t('title')", 'Hello'))
})

test('PDF: page options and print HTML shared by every engine', async () => {
  const o = pdfOptions({ pdf: { size: 'A4', margin: '15mm', footer: '{page} / {pages}' } })
  assert.equal(contentWidthPx(o), 680)
  assert.equal(o.margin.bottom, '20mm')
  assert.equal(marginBoxContent('Page {page} of {pages}'), '"Page " counter(page) " of " counter(pages)')
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'documents/invoice')
  const r = await previewDraft(project, { ...tpl, langKey: 'es' })
  assert.equal(r.format, 'pdf')
  assert.match(r.html, /@page \{ size: A4 portrait/)
  assert.match(r.html, /@bottom-center \{ content: counter\(page\) " \/ " counter\(pages\)/)
  assert.match(r.html, /\.mj-column-per-50 \{ width:50% !important/, 'desktop columns outside @media')
  assert.match(r.html, /<title>Factura 2026-0042 · Acme<\/title>/)
  assert.doesNotMatch(r.html, /aria-roledescription="email"/)
})

test('PDF: every available engine renders; veraPDF confirms PDF/UA-1 for the engines that support it', { timeout: 240000 }, async () => {
  const { renderDraftPdf } = await import('../src/engine/pipeline.js')
  const { closePdfBrowser, listEngines } = await import('../src/engine/pdf.js')
  const { validatePdf, verapdfRunner } = await import('../src/engine/verapdf.js')
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'documents/invoice')
  const engines = listEngines().filter(e => e.available)
  if (!engines.length) return
  const canValidate = !!verapdfRunner()
  for (const e of engines) {
    const { pdf, engine } = await renderDraftPdf(project, { ...tpl, langKey: 'es' }, { engine: e.id })
    assert.equal(engine, e.id)
    const raw = pdf.toString('latin1')
    assert.ok(raw.startsWith('%PDF'), e.id)
    if (canValidate) {
      const v = await validatePdf(pdf)
      if (e.pdfua) assert.ok(v.compliant, `${e.id} should meet PDF/UA-1: ${v.rules.map(r => r.id).join(', ')}`)
      else assert.equal(v.compliant, false, `${e.id} is flagged as not PDF/UA`)
    }
  }
  await closePdfBrowser()
})

test('attachments: normalized short and long forms', () => {
  assert.deepEqual(normalizeAttachments(['documents/invoice', 'https://x.y/a.pdf', { url: 'https://x.y/b', filename: 'b.pdf' }, { template: 'a/b', context: 'inv' }, { foo: 1 }]).map(a => [a.type, a.ref, a.filename, a.context]), [
    ['template', 'documents/invoice', '', ''],
    ['url', 'https://x.y/a.pdf', '', ''],
    ['url', 'https://x.y/b', 'b.pdf', ''],
    ['template', 'a/b', '', 'inv'],
    ['invalid', '', '', ''],
  ])
  assert.deepEqual(normalizeAttachments(undefined), [])
  assert.deepEqual(attachmentData({ context: 'invoice' }, { invoice: { number: 1 } }, { number: 0, year: 2026 }), { number: 1, year: 2026 })
  assert.deepEqual(attachmentData({}, { a: 1 }, { a: 0, b: 2 }), { a: 1, b: 2 })
})

test('attachments: local PDF templates follow the email language; remote URLs resolve $ commands', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'))
  const project = loadProject(DEMO, { outDir })
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const mjml = tpl.mjml.replace('    context: invoice', '    context: invoice\n  - url: "https://example.com/terms-$lang.pdf?v={{ year }}"')
  const i18n = YAML.parse(tpl.yml)
  const es = await compileSource(project, { mjml, i18n, links: readLinks(project), langKey: 'es' })
  assert.deepEqual(es.warnings, [])
  assert.equal(es.attachments.length, 2)
  assert.deepEqual(es.attachments[0], {
    index: 0, type: 'template', template: 'documents/invoice', langKey: 'es', locale: 'es-ES', context: 'invoice',
    filename: 'factura-{{ invoice.number }}.pdf', html: 'documents/invoice/invoice.es-ES.html',
    options: 'documents/invoice/invoice.es-ES.pdf.json', contentType: 'application/pdf',
  })
  assert.deepEqual(es.attachments[1], { index: 1, type: 'url', url: 'https://example.com/terms-es-ES.pdf?v={{ year }}', filename: 'terms-es-ES.pdf' })

  // preview: names and URLs rendered with the demo data
  const en = await previewDraft(project, { mjml, yml: tpl.yml, data: tpl.data, langKey: 'en' })
  assert.deepEqual(en.attachments.map(a => a.filename), ['invoice-2026-0042.pdf', 'terms-en-US.pdf'])
  assert.equal(en.attachments[1].url, 'https://example.com/terms-en-US.pdf?v=2026')

  // compile: <name>.<locale>.attachments.json for the backend
  await compileProject(project, { target: 'orders/order-confirmation', log: null })
  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'orders/order-confirmation/order-confirmation.en-US.attachments.json'), 'utf8'))
  assert.equal(json[0].html, 'documents/invoice/invoice.en-US.html')
  assert.equal(json[0].filename, 'invoice-{{ invoice.number }}.pdf')

  // missing template / missing language / not a PDF → warnings
  const bad = await compileSource(project, {
    mjml: '---\nattachments:\n  - template: nope/missing\n  - orders/order-confirmation\n---\n<mjml><mj-body></mj-body></mjml>',
    i18n: { messages: { fr: {} } }, links: {}, langKey: 'fr',
  })
  assert.equal(bad.attachments.length, 1)
  assert.match(bad.warnings.join('\n'), /nope\/missing does not exist/)
  assert.match(bad.warnings.join('\n'), /is not a PDF template/)
  assert.match(bad.warnings.join('\n'), /no "fr" texts; it is attached in "es"/)
})

test('attachments: remote files are downloaded with the rendered URL', async () => {
  const project = loadProject(DEMO)
  const seen = []
  const fetchImpl = async (url) => { seen.push(url); return new Response('%PDF-1.7 demo', { headers: { 'content-type': 'application/pdf' } }) }
  const att = { type: 'url', url: 'https://example.com/{{ doc }}.pdf', filename: '{{ doc }}.pdf' }
  const out = await renderAttachment(project, att, { doc: 'terms' }, { render: (t, d) => t.replace('{{ doc }}', d.doc), fetchImpl })
  assert.deepEqual(seen, ['https://example.com/terms.pdf'])
  assert.equal(out.filename, 'terms.pdf')
  assert.equal(out.contentType, 'application/pdf')
  assert.equal(out.content.toString(), '%PDF-1.7 demo')
  const failing = async () => new Response('no', { status: 404 })
  await assert.rejects(renderAttachment(project, att, { doc: 'x' }, { render: t => t.replace('{{ doc }}', 'x'), fetchImpl: failing }), /HTTP 404/)
})

test('attachments: the local invoice is rendered as a PDF in the email language', { timeout: 120000 }, async (t) => {
  if (!listEngines().some(e => e.available)) return t.skip('no PDF engine available')
  const project = loadProject(DEMO)
  const tpl = readTemplate(project, 'orders/order-confirmation')
  const [att] = await renderDraftAttachments(project, { ...tpl, langKey: 'es' })
  assert.equal(att.filename, 'factura-2026-0042.pdf')
  assert.equal(att.contentType, 'application/pdf')
  assert.equal(att.content.subarray(0, 5).toString(), '%PDF-')
})
