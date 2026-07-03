// Tiny JSON-file persistence layer.
// Zero native dependencies — the whole store is a single JSON file that is
// read into memory on boot and written back atomically on every mutation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The store location can be overridden with DB_FILE (used by the smoke test
// so it never touches real/seeded data).
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(__dirname, '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DB_FILE);

const EMPTY = { employees: [], knowledge: [], meetings: [], goals: [] };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let cache = null;

export function load() {
  if (cache) return cache;
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) };
    } catch {
      cache = structuredClone(EMPTY);
    }
  } else {
    cache = structuredClone(EMPTY);
    persist();
  }
  return cache;
}

export function persist() {
  ensureDir();
  // Atomic write: write to a temp file then rename so a crash mid-write
  // can never corrupt the primary data file.
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Replace the entire store (used by the seed script).
export function replaceAll(data) {
  cache = { ...EMPTY, ...data };
  persist();
  return cache;
}

// Convenience id generator — good enough for a local MVP.
export function id(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
