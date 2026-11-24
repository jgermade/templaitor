// Stubs of the Node built-ins the engine imports but the in-browser demo never needs at run time
// (child processes for git and the PDF engines, the HTTP server…).
const unavailable = (what) => () => { throw Object.assign(new Error(`${what} is not available in the browser demo`), { code: 'ENOENT' }) }

// child_process: every external tool (git, weasyprint, prince, veraPDF, docker) is "not installed"
export const spawnSync = () => ({ status: null, error: Object.assign(new Error('not available'), { code: 'ENOENT' }), stdout: '', stderr: '' })
export const execFile = (cmd, args, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb
  queueMicrotask(() => done?.(Object.assign(new Error(`${cmd}: not available in the browser demo`), { code: 'ENOENT' }), '', ''))
}
export const spawn = unavailable('Running programs')
export const exec = unavailable('Running programs')

// os
export const tmpdir = () => '/tmp'
export const homedir = () => '/'
export const platform = () => 'browser'
export const EOL = '\n'

// module
export const createRequire = () => Object.assign(unavailable('require()'), { resolve: unavailable('require.resolve()') })

// url
export const fileURLToPath = (u) => decodeURIComponent(new URL(String(u)).pathname)
export const pathToFileURL = (p) => new URL(`file://${p}`)

// http
export const createServer = unavailable('An HTTP server')

export default { spawnSync, execFile, spawn, exec, tmpdir, homedir, platform, EOL, createRequire, fileURLToPath, pathToFileURL, createServer }
