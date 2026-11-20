import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { splitFrontmatter } from '../shared/mjml-tree.js'
import { replaceImportCalls, applyParams } from '../shared/imports.js'

export function parseFrontmatter(content) {
  const { frontmatter, body } = splitFrontmatter(content)
  return { meta: frontmatter ? YAML.parse(frontmatter) || {} : {}, body }
}

/**
 * Absolute path of an $import. Accepts a file (`_partials/x.mjml`) or a component
 * folder (`_components/footer` → `_components/footer/footer.mjml`).
 */
export function resolveImportPath(baseDir, ref) {
  const clean = String(ref).trim().replace(/^['"]|['"]$/g, '')
  let full = path.resolve(baseDir, clean)
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) full = path.join(full, `${path.basename(full)}.mjml`)
  else if (!fs.existsSync(full) && fs.existsSync(`${full}.mjml`)) full = `${full}.mjml`
  return full
}

/** Reads an $import (without frontmatter) and its parameter declarations */
export function readImport(baseDir, ref) {
  const full = resolveImportPath(baseDir, ref)
  if (!fs.existsSync(full)) throw new Error(`$import: ${ref} does not exist`)
  const { meta, body } = parseFrontmatter(fs.readFileSync(full, 'utf8'))
  return { file: full, content: body, params: meta.params }
}

/** Content of an $import call with its parameters applied */
export function expandImport(baseDir, call, warn) {
  const r = readImport(baseDir, call.path)
  return { ...r, content: applyParams(r.content, r.params, call.params, (m) => warn?.(`${call.path}: ${m}`)) }
}

/**
 * Recursively replaces $import calls (with parameters).
 * `onImport(file)` is called for every imported file (e.g. to load the component texts).
 */
export function resolveImports(content, baseDir, { seen = [], onImport, warn } = {}) {
  return replaceImportCalls(content, (call) => {
    const { file, content: partial } = expandImport(baseDir, call, warn)
    if (seen.includes(file)) throw new Error(`Circular $import: ${call.path}`)
    onImport?.(file)
    return resolveImports(partial, baseDir, { seen: [...seen, file], onImport, warn })
  })
}

export function applyLayout(body, layoutName, { layoutsDir, baseDir, onImport, warn }) {
  const layoutPath = path.resolve(layoutsDir, layoutName)
  if (!fs.existsSync(layoutPath)) throw new Error(`Layout not found: ${layoutName}`)
  const layout = fs.readFileSync(layoutPath, 'utf8')
  if (!layout.includes('$content')) throw new Error(`Layout ${layoutName} does not contain $content`)
  const unified = layout.replace('$content', () => body)
  return resolveImports(unified, baseDir, { onImport, warn })
}

/**
 * Wraps a fragment (e.g. a component) in an MJML document using the <mj-head>
 * and the <mj-body> attributes of a layout, without its content.
 */
export function wrapFragment(body, layoutPath) {
  let head = ''
  let bodyAttrs = ''
  if (layoutPath && fs.existsSync(layoutPath)) {
    const layout = fs.readFileSync(layoutPath, 'utf8')
    head = layout.match(/<mj-head[\s\S]*?<\/mj-head>/)?.[0] || ''
    bodyAttrs = layout.match(/<mj-body([^>]*)>/)?.[1] || ''
  }
  return `<mjml lang="$lang">\n${head}\n<mj-body${bodyAttrs}>\n${body}\n</mj-body>\n</mjml>\n`
}
