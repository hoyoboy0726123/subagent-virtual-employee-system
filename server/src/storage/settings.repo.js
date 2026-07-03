// Storage layer: key/value settings (runtime mode, etc.).
import { getDb } from '../db/connection.js';

export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, String(value));
  return value;
}
