// Node globals the engine reads (process.env, Buffer) — installed before any engine module is evaluated
import { Buffer } from 'buffer'

globalThis.Buffer ??= Buffer
globalThis.process ??= { env: {}, cwd: () => '/', platform: 'browser', once() {}, on() {}, versions: {}, nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)) }
globalThis.process.env ??= {}
