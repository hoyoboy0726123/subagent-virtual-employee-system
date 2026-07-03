// Schema migrations.
//
// Migrations are an ordered list. On boot we read `PRAGMA user_version` and
// apply every migration whose index is beyond the stored version, inside a
// transaction, then bump user_version. This makes startup idempotent and gives
// us a real (if minimal) migration story — new migrations just append here.
import { withTx } from './tx.js';

const MIGRATIONS = [
  // v1 — core tables + full-text search over knowledge chunks.
  (db) => {
    db.exec(`
      CREATE TABLE employees (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        role_title          TEXT NOT NULL,
        personality         TEXT DEFAULT '',
        expertise           TEXT DEFAULT '[]',   -- JSON array
        objectives          TEXT DEFAULT '',
        communication_style TEXT DEFAULT '',
        profile             TEXT DEFAULT '',
        created_at          TEXT NOT NULL
      );

      -- A knowledge "document" is one uploaded note/snippet/doc for an employee.
      CREATE TABLE documents (
        id          TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        title       TEXT NOT NULL DEFAULT 'Untitled',
        content     TEXT NOT NULL,
        source      TEXT DEFAULT 'note',          -- note | file | url | import
        tags        TEXT DEFAULT '[]',            -- JSON array
        metadata    TEXT DEFAULT '{}',            -- JSON object (arbitrary fields)
        created_at  TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_documents_employee ON documents(employee_id);

      -- Each document is split into retrievable chunks. employee_id is
      -- denormalized onto the chunk so retrieval can scope by employee(s)
      -- without a join back to documents.
      CREATE TABLE chunks (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chunks_document ON chunks(document_id);
      CREATE INDEX idx_chunks_employee ON chunks(employee_id);

      -- FTS5 keyword index over chunk text. chunk_id / employee_id are stored
      -- UNINDEXED so we can join back and scope by employee inside a MATCH query.
      -- Kept in sync manually by the knowledge repository (see knowledge.repo).
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        content,
        chunk_id UNINDEXED,
        employee_id UNINDEXED,
        tokenize = 'porter unicode61'
      );

      CREATE TABLE meetings (
        id              TEXT PRIMARY KEY,
        topic           TEXT NOT NULL,
        participant_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of employee ids
        participants    TEXT NOT NULL DEFAULT '[]', -- JSON array of {id,name,roleTitle}
        rounds          INTEGER NOT NULL DEFAULT 3,
        transcript      TEXT NOT NULL DEFAULT '[]', -- JSON
        minutes         TEXT NOT NULL DEFAULT '{}', -- JSON
        report          TEXT NOT NULL DEFAULT '',
        grounding       TEXT NOT NULL DEFAULT '[]', -- JSON: retrieved chunks used
        runtime         TEXT NOT NULL DEFAULT '{}', -- JSON: {mode,label,fallback}
        created_at      TEXT NOT NULL
      );

      CREATE TABLE goals (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        description  TEXT DEFAULT '',
        assignee_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array of employee ids
        assignees    TEXT NOT NULL DEFAULT '[]',   -- JSON array of {id,name,roleTitle}
        status       TEXT NOT NULL DEFAULT 'in-progress',
        tasks        TEXT NOT NULL DEFAULT '[]',   -- JSON
        output       TEXT NOT NULL DEFAULT '',
        grounding    TEXT NOT NULL DEFAULT '[]',   -- JSON
        runtime      TEXT NOT NULL DEFAULT '{}',   -- JSON
        created_at   TEXT NOT NULL
      );

      -- Simple key/value settings store (runtime mode, etc.).
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },
];

export function migrate(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  const current = db.prepare('PRAGMA user_version').get().user_version;

  for (let v = current; v < MIGRATIONS.length; v++) {
    withTx(db, () => {
      MIGRATIONS[v](db);
      // user_version can't be parameterized; v+1 is an integer we control.
      db.exec(`PRAGMA user_version = ${v + 1};`);
    });
  }

  return { from: current, to: MIGRATIONS.length };
}

export const LATEST_VERSION = MIGRATIONS.length;
