// prepack: ship the version history of the repository's templates in the npm package
// (.templaitor/versions.json), so `engine.render(id, { version })` works for consumers. Skipped without git.
import { loadProject } from '../src/engine/project.js'
import { exportVersions } from '../src/engine/snapshot.js'

const root = new URL('..', import.meta.url).pathname
try {
  const r = await exportVersions(loadProject(root))
  console.log(`templaitor: ${r.versions} template version(s) exported to .templaitor/versions.json`)
} catch (e) {
  console.warn(`templaitor: versions not exported (${e.message})`)
}
