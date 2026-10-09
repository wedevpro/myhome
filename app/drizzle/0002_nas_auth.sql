CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
