#!/usr/bin/env node
// Builds self-contained binary bundles: the app, its production dependencies, the prebuilt editor and an
// official Node.js runtime, so the target machine needs nothing else installed.
//
//   node scripts/build-binary.mjs                         # every target (downloads Node.js from nodejs.org)
//   node scripts/build-binary.mjs --targets linux-x64     # some targets (comma separated)
//   node scripts/build-binary.mjs --targets linux-x64 --node "$(command -v node)"
//                                                         # reuse a local Node binary (offline, same platform)
//
// Output (artifacts/):
//   templaitor-<os>-<arch>.tar.gz          (+ .sha256)  → templaitor/bin/templaitor, templaitor/node, templaitor/app
// The file names carry no version so `releases/latest/download/<name>` always works (setup.sh uses it).
// Requires `npm run build` first (dist/editor). Node version: $NODE_VERSION or the one running this script.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// POSIX launcher: follows symlinks (setup.sh links it into <prefix>/bin) and runs the bundled Node.
const LAUNCHER = `#!/bin/sh
# templaitor launcher: runs the app with the Node.js runtime shipped next to it.
set -e
self="$0"
while [ -h "$self" ]; do
  link="$(readlink "$self")"
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
home="$(cd "$(dirname "$self")/.." && pwd)"
exec "$home/node/bin/node" "$home/app/bin/templaitor.js" "$@"
`

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALL_TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? def : args[i + 1]
}
const targets = (opt('targets', process.env.TEMPLAITOR_TARGETS) || ALL_TARGETS.join(',')).split(',').map(t => t.trim()).filter(Boolean)
const localNode = opt('node')
const outDir = path.resolve(root, opt('out', 'artifacts'))
const nodeVersion = (process.env.NODE_VERSION || process.versions.node).replace(/^v/, '')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

for (const t of targets) if (!ALL_TARGETS.includes(t)) throw new Error(`Unknown target ${t} (${ALL_TARGETS.join(', ')})`)
if (localNode && targets.length !== 1) throw new Error('--node only works with a single --targets entry')
if (!fs.existsSync(path.join(root, 'dist/editor/index.html'))) throw new Error('dist/editor is missing: run `npm run build` first')
const [major, minor] = nodeVersion.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) throw new Error(`Node ${nodeVersion} is too old: the bundle needs ≥ 22.13 (templaitor serve uses node:sqlite)`)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'templaitor-binary-'))
const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })

try {
  // ── platform-independent app tree (no native modules: node:sqlite is built in, pg is pure JS) ──
  const app = path.join(work, 'app')
  fs.mkdirSync(app)
  for (const f of ['bin', 'src', 'assets', 'examples/demo', 'dist/editor', 'package.json', 'package-lock.json', 'README.md']) {
    // compiled output of the demo project is not shipped
    fs.cpSync(path.join(root, f), path.join(app, f), { recursive: true, filter: src => path.relative(root, src) !== path.join('examples/demo/dist') })
  }
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], app)
  fs.rmSync(path.join(app, 'package-lock.json'))
  const natives = listFiles(path.join(app, 'node_modules')).filter(f => f.endsWith('.node'))
  if (natives.length) throw new Error(`Native modules would make the bundle platform-specific: ${natives.join(', ')}`)

  fs.mkdirSync(outDir, { recursive: true })
  for (const target of targets) {
    const stage = path.join(work, target, 'templaitor')
    fs.mkdirSync(path.join(stage, 'bin'), { recursive: true })
    fs.mkdirSync(path.join(stage, 'node/bin'), { recursive: true })
    fs.cpSync(app, path.join(stage, 'app'), { recursive: true })

    const node = localNode ? path.resolve(localNode) : await downloadNode(target, path.join(work, target))
    fs.copyFileSync(node, path.join(stage, 'node/bin/node'))
    fs.chmodSync(path.join(stage, 'node/bin/node'), 0o755)
    const license = path.join(path.dirname(node), '../LICENSE')
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(stage, 'node/LICENSE'))

    fs.writeFileSync(path.join(stage, 'bin/templaitor'), LAUNCHER, { mode: 0o755 })
    fs.writeFileSync(path.join(stage, 'VERSION'), `${version}\n`)
    fs.writeFileSync(path.join(stage, 'TARGET'), `${target} node-v${localNode ? process.versions.node : nodeVersion}\n`)

    const name = `templaitor-${target}.tar.gz`
    const file = path.join(outDir, name)
    const gnu = execFileSync('tar', ['--version'], { encoding: 'utf8' }).includes('GNU')
    run('tar', ['-czf', file, ...(gnu ? ['--owner=0', '--group=0', '--numeric-owner'] : []), '-C', path.dirname(stage), 'templaitor'])
    const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    fs.writeFileSync(`${file}.sha256`, `${sha}  ${name}\n`)
    console.log(`✓ ${path.relative(root, file)} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB · v${version} · node ${localNode ? process.versions.node : nodeVersion})`)
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}

// Downloads the official Node.js build for a target and checks it against SHASUMS256.txt.
async function downloadNode(target, dir) {
  const base = `https://nodejs.org/dist/v${nodeVersion}`
  const name = `node-v${nodeVersion}-${target}.tar.gz`
  const sums = await (await fetchOk(`${base}/SHASUMS256.txt`)).text()
  const expected = sums.split('\n').find(l => l.endsWith(`  ${name}`))?.split(' ')[0]
  if (!expected) throw new Error(`${name} is not listed in ${base}/SHASUMS256.txt`)
  const buf = Buffer.from(await (await fetchOk(`${base}/${name}`)).arrayBuffer())
  const actual = crypto.createHash('sha256').update(buf).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}`)
  fs.mkdirSync(dir, { recursive: true })
  const archive = path.join(dir, name)
  fs.writeFileSync(archive, buf)
  run('tar', ['-xzf', archive, '-C', dir])
  return path.join(dir, `node-v${nodeVersion}-${target}`, 'bin/node')
}

async function fetchOk(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res
}

function listFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath ?? e.path, e.name))
}
