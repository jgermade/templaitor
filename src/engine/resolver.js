import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { splitFrontmatter } from '../shared/mjml-tree.js'

export function parseFrontmatter(content) {
  const { frontmatter, body } = splitFrontmatter(content)
  return { meta: frontmatter ? YAML.parse(frontmatter) || {} : {}, body }
}

export function resolveImports(content, baseDir, seen = []) {
  return content.replace(/\$import\(\s*([^)]+?)\s*\)/g, (_, filePath) => {
    const fullPath = path.resolve(baseDir, filePath.trim().replace(/^['"]|['"]$/g, ''))
    if (seen.includes(fullPath)) throw new Error(`$import circular: ${filePath}`)
    if (!fs.existsSync(fullPath)) throw new Error(`$import: no existe ${filePath}`)
    const partial = fs.readFileSync(fullPath, 'utf8')
    return resolveImports(partial, baseDir, [...seen, fullPath])
  })
}

export function applyLayout(body, layoutName, { layoutsDir, baseDir }) {
  const layoutPath = path.resolve(layoutsDir, layoutName)
  if (!fs.existsSync(layoutPath)) throw new Error(`Layout no encontrado: ${layoutName}`)
  const layout = fs.readFileSync(layoutPath, 'utf8')
  if (!layout.includes('$content')) throw new Error(`El layout ${layoutName} no contiene $content`)
  const unified = layout.replace('$content', () => body)
  return resolveImports(unified, baseDir)
}
