/** Tablas de la ronda. El mismo script corre en node:sqlite y en el Durable Object. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS round (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  pool_amount TEXT NOT NULL,
  fichitas_per_attendee INTEGER NOT NULL,
  max_fichitas_per_project INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  recipient TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendees (
  luma_guest_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  luma_guest_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  fichitas INTEGER NOT NULL CHECK (fichitas > 0),
  PRIMARY KEY (luma_guest_id, project_id)
);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  dry_run INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
  telegram_user_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_plan (
  idempotency_key TEXT PRIMARY KEY,
  round_id INTEGER NOT NULL,
  admin_telegram_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  fallback_notified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payout_plan_line (
  idempotency_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  celo_tx_hash TEXT,
  PRIMARY KEY (idempotency_key, recipient)
);
`;
