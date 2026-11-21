// Schema migrations, append only. Portable SQL: TEXT ids, timestamps in ms (`t.bigint`: INTEGER in SQLite,
// BIGINT in Postgres) and binary content (`t.blob`: BLOB · BYTEA).
export const MIGRATIONS = [
  (t) => `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    created_at ${t.bigint} NOT NULL,
    last_login_at ${t.bigint}
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_org_id TEXT,
    created_at ${t.bigint} NOT NULL,
    expires_at ${t.bigint} NOT NULL,
    last_seen_at ${t.bigint} NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at ${t.bigint} NOT NULL,
    expires_at ${t.bigint} NOT NULL,
    used_at ${t.bigint}
  );
  CREATE INDEX otp_codes_email ON otp_codes(email, created_at);

  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    name TEXT NOT NULL DEFAULT '',
    created_at ${t.bigint} NOT NULL,
    last_used_at ${t.bigint}
  );

  CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_id TEXT,
    kind TEXT NOT NULL,
    expires_at ${t.bigint} NOT NULL
  );

  CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at ${t.bigint} NOT NULL,
    smtp TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE memberships (
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at ${t.bigint} NOT NULL,
    PRIMARY KEY (org_id, user_id)
  );

  CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at ${t.bigint} NOT NULL,
    accepted_at ${t.bigint},
    UNIQUE (org_id, email)
  );

  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at ${t.bigint} NOT NULL,
    last_used_at ${t.bigint},
    revoked_at ${t.bigint}
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    api_key_id TEXT,
    user_id TEXT,
    kind TEXT NOT NULL,
    template TEXT,
    locale TEXT,
    recipients TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at ${t.bigint} NOT NULL,
    last_error TEXT,
    smtp_message_id TEXT,
    idempotency_key TEXT,
    created_at ${t.bigint} NOT NULL,
    updated_at ${t.bigint} NOT NULL,
    sent_at ${t.bigint},
    UNIQUE (org_id, idempotency_key)
  );
  CREATE INDEX messages_queue ON messages(status, next_attempt_at);
  CREATE INDEX messages_org ON messages(org_id, created_at);

  CREATE TABLE files (
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content ${t.blob} NOT NULL,
    hash TEXT NOT NULL,
    updated_at ${t.bigint} NOT NULL,
    PRIMARY KEY (org_id, path)
  );
  `,
]

/** Applies the pending migrations (each one in a transaction) */
export async function migrate(db, types) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at ${types.bigint} NOT NULL)`)
  const done = new Set((await db.all('SELECT version FROM schema_migrations')).map(r => Number(r.version)))
  for (const [i, migration] of MIGRATIONS.entries()) {
    const version = i + 1
    if (done.has(version)) continue
    await db.tx(async () => {
      await db.exec(migration(types))
      await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, Date.now())
    })
  }
}
