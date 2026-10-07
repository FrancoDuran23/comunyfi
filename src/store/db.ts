import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
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
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
