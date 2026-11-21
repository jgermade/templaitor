// Schema migrations (portable SQL: TEXT ids, INTEGER timestamps in ms). Append only.
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_org_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
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
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );

  CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_id TEXT,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    smtp TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE memberships (
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (org_id, user_id)
  );

  CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    UNIQUE (org_id, email)
  );

  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
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
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    smtp_message_id TEXT,
    idempotency_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sent_at INTEGER,
    UNIQUE (org_id, idempotency_key)
  );
  CREATE INDEX messages_queue ON messages(status, next_attempt_at);
  CREATE INDEX messages_org ON messages(org_id, created_at);

  CREATE TABLE files (
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content BLOB NOT NULL,
    hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (org_id, path)
  );
  `,
]
