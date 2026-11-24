// GitHub Pages: the API reference (site/api) documents every route, and the in-browser demo's virtual fs
// (editor/demo) behaves like the subset of node:fs the engine uses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadProject } from '../src/engine/project.js'
import { createRoutes } from '../src/server/server.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

test('site/api documents every HTTP route (and only existing ones)', () => {
  const server = read('src/server/server.js')
  const routes = new Set([
    // editor API (JSON routes)
    ...Object.keys(createRoutes(loadProject(path.join(ROOT, 'examples/demo')))),
    // editor API routes handled before the JSON table (binary bodies or answers)
    ...[...server.matchAll(/url\.pathname === '(\/api\/[^']+)' && req\.method === '(\w+)'/g)].map(m => `${m[2]} ${m[1]}`),
    'GET /preview/:id',
    'GET /static/:path',
    // hosted service
    ...[...read('src/service/app.js').matchAll(/^\s*\['(GET|POST|PUT|PATCH|DELETE)', '([^']+)'/gm)].map(m => `${m[1]} ${m[2]}`),
  ])
  const documented = new Set([...read('site/api/index.html').matchAll(/data-route="([^"]+)"/g)].map(m => m[1]))
  assert.ok(routes.size > 50, `found ${routes.size} routes`)
  assert.deepEqual([...routes].filter(r => !documented.has(r)), [], 'routes missing from site/api/index.html')
  assert.deepEqual([...documented].filter(r => !routes.has(r)), [], 'documented routes that do not exist')
})

test('demo: the virtual fs supports what the engine uses', async () => {
  const vfs = await import('../editor/demo/shims/fs.js')
  const fsv = vfs.default
  const changed = []
  vfs.vfs.onChange = (p) => changed.push(p)
  fsv.writeFileSync('/p/templates/a/a.mjml', '<mjml/>')
  fsv.writeFileSync('/p/templates/_shared/logo.png', new Uint8Array([1, 2, 3]))
  assert.equal(fsv.readFileSync('/p/templates/a/a.mjml', 'utf8'), '<mjml/>')
  assert.deepEqual([...fsv.readFileSync('/p/templates/_shared/logo.png')], [1, 2, 3])
  assert.ok(fsv.existsSync('/p/templates') && fsv.statSync('/p/templates').isDirectory())
  assert.deepEqual(fsv.readdirSync('/p/templates'), ['_shared', 'a'])
  assert.deepEqual(fsv.readdirSync('/p/templates', { withFileTypes: true }).map(d => [d.name, d.isDirectory()]), [['_shared', true], ['a', true]])
  assert.equal(fsv.statSync('/p/templates/_shared/logo.png').size, 3)
  assert.throws(() => fsv.readFileSync('/p/missing'), { code: 'ENOENT' })
  assert.throws(() => fsv.rmSync('/p/templates'), { code: 'ENOTEMPTY' })
  fsv.rmSync('/p/templates/a', { recursive: true })
  assert.equal(fsv.existsSync('/p/templates/a/a.mjml'), false)
  fsv.rmSync('/p/nothing', { force: true })
  assert.ok(changed.includes('/p/templates/a/a.mjml') && changed.includes('/p/templates/a'))
})
