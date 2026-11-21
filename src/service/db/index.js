// Database adapters for the hosted service: sqlite (default) · postgres. Same async interface.
export async function openDatabase(database) {
  if (database.driver === 'postgres') {
    const { openPostgres } = await import('./postgres.js')
    return openPostgres(database.url)
  }
  const { openSqlite } = await import('./sqlite.js')
  return openSqlite(database.file)
}
