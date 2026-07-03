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
// tests that want a clean slate. Safe because the schema is fully recreated.
export function resetDb() {
  const conn = getDb();
  conn.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS meetings;
    DROP TABLE IF EXISTS goals;
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS employees;
    PRAGMA user_version = 0;
  `);
  migrate(conn);
  return conn;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
