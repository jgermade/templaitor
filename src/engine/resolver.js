import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { splitFrontmatter } from '../shared/mjml-tree.js'

export const IMPORT_RE = /\$import\(\s*([^)]+?)\s*\)/g

export function parseFrontmatter(content) {
  const { frontmatter, body } = splitFrontmatter(content)
  return { meta: frontmatter ? YAML.parse(frontmatter) || {} : {}, body }
}

/**
 * Ruta absoluta de un $import. Admite fichero (`_partials/x.mjml`) o carpeta de
 * componente (`_components/footer` → `_components/footer/footer.mjml`).
 */
export function resolveImportPath(baseDir, ref) {
  const clean = String(ref).trim().replace(/^['"]|['"]$/g, '')
  let full = path.resolve(baseDir, clean)
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) full = path.join(full, `${path.basename(full)}.mjml`)
  else if (!fs.existsSync(full) && fs.existsSync(`${full}.mjml`)) full = `${full}.mjml`
  return full
}

/** Lee el contenido de un $import (sin frontmatter) */
export function readImport(baseDir, ref) {
  const full = resolveImportPath(baseDir, ref)
  if (!fs.existsSync(full)) throw new Error(`$import: no existe ${ref}`)
  return { file: full, content: splitFrontmatter(fs.readFileSync(full, 'utf8')).body }
}

/**
 * Sustituye recursivamente los $import.
 * `onImport(file)` se llama por cada fichero importado (p.ej. para cargar los textos del componente).
 */
export function resolveImports(content, baseDir, { seen = [], onImport } = {}) {
  return content.replace(IMPORT_RE, (_, ref) => {
    const { file, content: partial } = readImport(baseDir, ref)
    if (seen.includes(file)) throw new Error(`$import circular: ${ref}`)
    onImport?.(file)
    return resolveImports(partial, baseDir, { seen: [...seen, file], onImport })
  })
}

export function applyLayout(body, layoutName, { layoutsDir, baseDir, onImport }) {
  const layoutPath = path.resolve(layoutsDir, layoutName)
  if (!fs.existsSync(layoutPath)) throw new Error(`Layout no encontrado: ${layoutName}`)
  const layout = fs.readFileSync(layoutPath, 'utf8')
  if (!layout.includes('$content')) throw new Error(`El layout ${layoutName} no contiene $content`)
  const unified = layout.replace('$content', () => body)
  return resolveImports(unified, baseDir, { onImport })
}

/**
 * Envuelve un fragmento (p.ej. un componente) en un documento MJML usando el
 * <mj-head> y los atributos de <mj-body> de un layout, sin su contenido.
 */
export function wrapFragment(body, layoutPath) {
  let head = ''
  let bodyAttrs = ''
  if (layoutPath && fs.existsSync(layoutPath)) {
    const layout = fs.readFileSync(layoutPath, 'utf8')
    head = layout.match(/<mj-head[\s\S]*?<\/mj-head>/)?.[0] || ''
    bodyAttrs = layout.match(/<mj-body([^>]*)>/)?.[1] || ''
  }
  return `<mjml>\n${head}\n<mj-body${bodyAttrs}>\n${body}\n</mj-body>\n</mjml>\n`
}
