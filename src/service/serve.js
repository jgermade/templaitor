// `templaitor serve`: the hosted service (users, organizations, editor per org, send API).
import http from 'node:http'
import { loadServiceConfig } from './config.js'
import { createApp } from './app.js'

export async function serve({ cwd, file, port, host } = {}) {
  const config = loadServiceConfig({ cwd, file, overrides: { ...(port ? { port: Number(port) } : {}), ...(host ? { host } : {}) } })
  if (port) config.port = Number(port)
  const app = await createApp(config)
  app.sender.start()
  const cleanup = setInterval(() => app.repo.deleteExpired(), 3600e3)
  cleanup.unref()
  const server = http.createServer(app.handler)
  server.requestTimeout = 120000
  await new Promise(r => server.listen(config.port, config.host, r))
  console.log(`\n✎ templaitor service → ${config.baseUrl} (listening on ${config.host}:${config.port})`)
  console.log(`  data: ${config.dataDir} · storage: ${config.storage.driver} · signup: ${config.signup} · system SMTP: ${config.smtp ? config.smtp.host : 'none (codes printed here)'}\n`)
  const stop = async () => {
    console.log('\nStopping…')
    server.close()
    await app.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return { server, app, config }
}
