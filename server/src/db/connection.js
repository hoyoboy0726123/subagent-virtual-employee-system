// SQLite connection.
//
// We use Node's built-in `node:sqlite` (DatabaseSync) — no native build step,
// no extra npm dependency, and it ships FTS5. This keeps local setup to a plain
// `npm install`. Requires Node >= 22.5 (tested on 22.22).
//
// The connection is a lazily-created singleton; migrations run on first open.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { migrate } from './migrations.js';

let db = null;

export function getDb() {
  if (db) return db;

  if (config.dbFile !== ':memory:') {
    const dir = path.dirname(config.dbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

// Drop everything and re-migrate. Used by the seed script's --reset path and by
// tests that want a clean slate. Dropped dynamically from sqlite_master so new
// migrations' tables (research_reports, dialogues, …) are always cleared —
// hard-coding the list silently broke `npm run seed` when v2/v6 landed.
export function resetDb() {
  const conn = getDb();
  const tables = conn
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  conn.exec('PRAGMA foreign_keys = OFF;');
  for (const name of tables) conn.exec(`DROP TABLE IF EXISTS "${name}";`);
  conn.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 0;');
  migrate(conn);
  return conn;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
