// site/setup.sh (the one-line installer): install, update, reinstall and uninstall of the binary bundle
// against a local release mirror (file://), with checksum verification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'

const SETUP = path.resolve(import.meta.dirname, '../site/setup.sh')
const TARGET = `${{ linux: 'linux', darwin: 'darwin' }[process.platform]}-${{ x64: 'x64', arm64: 'arm64' }[process.arch]}`
const has = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0
const skip = !['linux', 'darwin'].includes(process.platform) || !has('curl') || !has('tar') ? 'needs a POSIX shell, curl and tar' : false

// A fake bundle: same layout as scripts/build-binary.mjs, the launcher prints the version
function publish(dir, version) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-stage-'))
  fs.mkdirSync(path.join(stage, 'templaitor/bin'), { recursive: true })
  fs.writeFileSync(path.join(stage, 'templaitor/VERSION'), `${version}\n`)
  fs.writeFileSync(path.join(stage, 'templaitor/bin/templaitor'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
  const name = `templaitor-${TARGET}.tar.gz`
  for (const sub of ['latest/download', `download/v${version}`]) {
    const out = path.join(dir, sub)
    fs.mkdirSync(out, { recursive: true })
    execFileSync('tar', ['-czf', path.join(out, name), '-C', stage, 'templaitor'])
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex')
    fs.writeFileSync(path.join(out, `${name}.sha256`), `${sha}  ${name}\n`)
  }
  fs.rmSync(stage, { recursive: true, force: true })
  return path.join(dir, 'latest/download', `${name}.sha256`)
}

test('setup.sh: install, update, reinstall and uninstall the binary', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-setup-'))
  const mirror = path.join(tmp, 'mirror')
  const prefix = path.join(tmp, 'prefix')
  const bin = path.join(prefix, 'bin/templaitor')
  const env = { ...process.env, TEMPLAITOR_DOWNLOAD_URL: `file://${mirror}`, NO_COLOR: '1' }
  const setup = (...argv) => spawnSync('sh', [SETUP, ...argv, '--prefix', prefix], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const version = () => execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()
  try {
    publish(mirror, '1.0.0')

    let r = setup('install')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /Checksum verified/)
    assert.equal(version(), '1.0.0')
    assert.ok(fs.lstatSync(bin).isSymbolicLink())

    r = setup('install')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /already installed/)

    r = setup('update')
    assert.match(r.stderr, /up to date/)

    publish(mirror, '1.1.0')
    r = setup('update')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /1\.0\.0 → 1\.1\.0/)
    assert.equal(version(), '1.1.0')

    r = setup('reinstall', '--version', '1.0.0')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(version(), '1.0.0')

    const sums = publish(mirror, '1.2.0')
    fs.writeFileSync(sums, `${'0'.repeat(64)}  x\n`)
    r = setup('update')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Checksum mismatch/)
    assert.equal(version(), '1.0.0', 'a failed update leaves the installed version in place')

    r = setup('uninstall')
    assert.equal(r.status, 1, 'uninstall without a terminal needs --yes')
    r = setup('uninstall', '--yes')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!fs.existsSync(bin))
    assert.ok(!fs.existsSync(path.join(prefix, 'lib/templaitor')))

    r = spawnSync('sh', [SETUP], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.equal(r.status, 2, 'no action and no terminal → usage')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
