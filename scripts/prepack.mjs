// prepack: what the npm package ships besides the code, generated from the repository's templates:
//   .templaitor/versions.json — their version history (exported from git; skipped without git), so
//                               `engine.render(id, { version })` works for consumers
//   templates.d.ts            — TypeScript types of their data contracts (TemplateData)
import fs from 'node:fs'
import { loadProject } from '../src/engine/project.js'
import { exportVersions } from '../src/engine/snapshot.js'
import { projectTypes } from '../src/engine/types.js'

const root = new URL('..', import.meta.url).pathname
const project = loadProject(root)
try {
  const r = await exportVersions(project)
  console.log(`templaitor: ${r.versions} template version(s) exported to .templaitor/versions.json`)
} catch (e) {
  console.warn(`templaitor: versions not exported (${e.message})`)
}
fs.writeFileSync(new URL('templates.d.ts', new URL('..', import.meta.url)), projectTypes(project))
console.log('templaitor: templates.d.ts written')
