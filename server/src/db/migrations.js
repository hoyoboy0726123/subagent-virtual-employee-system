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

  // v2 — autonomous research reports (Phase 14). An employee agent researches a
  // topic on the web, writes an investigation report, and the MANAGER (the user)
  // reviews it: approval ingests it into that employee's knowledge base;
  // rejection just archives it. The report stays linked to its web sources.
  (db) => {
    db.exec(`
      CREATE TABLE research_reports (
        id          TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        topic       TEXT NOT NULL,
        report      TEXT NOT NULL DEFAULT '',
        sources     TEXT NOT NULL DEFAULT '[]',  -- JSON: [{title,url}] consulted web sources
        queries     TEXT NOT NULL DEFAULT '[]',  -- JSON: web queries the agent ran
        status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
        live        INTEGER NOT NULL DEFAULT 1,
        document_id TEXT DEFAULT NULL,           -- knowledge doc created on approval
        created_at  TEXT NOT NULL,
        reviewed_at TEXT DEFAULT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_research_employee ON research_reports(employee_id);
      CREATE INDEX idx_research_status ON research_reports(status);
    `);
  },

  // v3 — per-agent configuration (Phase 15). Each employee can override the
  // global agent defaults: model id, sampling temperature, whether it may use
  // web search, and its per-turn tool budget. '{}' inherits everything.
  (db) => {
    db.exec(`ALTER TABLE employees ADD COLUMN agent_config TEXT NOT NULL DEFAULT '{}';`);
  },

  // v4 — CJK-aware FTS (Phase 15). unicode61 treats a run of CJK characters as
  // ONE token, which made Chinese retrieval nearly useless (only exact whole-run
  // matches). Fix: store FTS content with CJK characters space-segmented (each
  // char = one token) and query CJK terms as phrases ("電 商 物 流"), so any
  // Chinese substring of 2+ chars matches. English tokenization is unchanged.
  // Rebuild the index from the chunks table with segmentation applied.
  (db) => {
    db.exec(`
      DROP TABLE chunks_fts;
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        content,
        chunk_id UNINDEXED,
        employee_id UNINDEXED,
        tokenize = 'porter unicode61'
      );
    `);
    const rows = db.prepare('SELECT id, employee_id, content FROM chunks').all();
    const ins = db.prepare('INSERT INTO chunks_fts (content, chunk_id, employee_id) VALUES (?, ?, ?)');
    const CJK = /([㐀-䶿一-鿿豈-﫿])/g;
    for (const r of rows) ins.run(String(r.content).replace(CJK, ' $1 '), r.id, r.employee_id);
  },

  // v5 — manager-chaired meeting lifecycle (Phase 16). A meeting is no longer a
  // one-shot script: it stays 'discussing' after its rounds (the MANAGER decides
  // whether to continue, interject, or conclude), and only concluding produces
  // the minutes/report and distills memories. Existing rows are all concluded.
  (db) => {
    db.exec("ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'concluded';");
  },

  // v6 — manager 1-on-1 dialogues (Phase 19). An unlimited-turn conversation
  // between the MANAGER (the human) and ONE employee agent; on close the
  // manager decides whether the record is distilled into the employee's
  // knowledge base.
  (db) => {
    db.exec(`
      CREATE TABLE dialogues (
        id          TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        transcript  TEXT NOT NULL DEFAULT '[]',  -- JSON: [{who:'manager'|'employee', text, toolCalls, citations, at}]
        status      TEXT NOT NULL DEFAULT 'open', -- open | closed
        saved_doc_id TEXT DEFAULT NULL,           -- knowledge doc created on save-and-close
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_dialogues_employee ON dialogues(employee_id);
      CREATE INDEX idx_dialogues_status ON dialogues(status);
    `);
  },

  // v7 — chunk embeddings for hybrid semantic retrieval (D2). The table always
  // exists but is only populated when embeddings are enabled AND the local model
  // loads (standalone-first: zero rows here === today's pure-BM25 behaviour).
  // Vectors are L2-normalized Float32 stored as a BLOB, so cosine similarity is a
  // plain dot product. employee_id is denormalized for scoped cosine scans (same
  // pattern as chunks). `model`+`dim` are recorded so a model change can be
  // detected and re-indexed instead of silently mixing incompatible vectors.
  // FK ON DELETE CASCADE off chunks means deleting a document/chunk clears its
  // embedding automatically (unlike chunks_fts, which has no FK).
  (db) => {
    db.exec(`
      CREATE TABLE chunk_embeddings (
        chunk_id    TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        model       TEXT NOT NULL,
        dim         INTEGER NOT NULL,
        vector      BLOB NOT NULL,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (chunk_id)    REFERENCES chunks(id)    ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chunk_emb_employee ON chunk_embeddings(employee_id);
    `);
  },

  // v8 — per-meeting output mode. 'full' (default) = decisions + action items
  // (spinnable into goals); 'conclusion' = the team converges to a final
  // decision/recommendation only, with NO action items — chosen at meeting
  // creation to keep the discussion focused and the report todo-free.
  (db) => {
    db.exec("ALTER TABLE meetings ADD COLUMN output_mode TEXT NOT NULL DEFAULT 'full';");
  },

  // v9 — meeting agenda (待討論事項). Optional bulleted list of the specific
  // items the meeting must resolve; agents address them during discussion and
  // the report (especially in conclusion mode) gives a clear answer per item.
  (db) => {
    db.exec("ALTER TABLE meetings ADD COLUMN agenda TEXT NOT NULL DEFAULT '';");
  },

  // v10 — quick meeting room. quick=1 means a fast, shallow session: agents give
  // a brief view from their ROLE (no deep knowledge-base grounding, no tools),
  // and the manager agent produces a preliminary conclusion with no action items.
  (db) => {
    db.exec('ALTER TABLE meetings ADD COLUMN quick INTEGER NOT NULL DEFAULT 0;');
  },

  // v11 — close the loop: a goal spawned from a meeting remembers its source, so
  // once its tasks are delivered the results can be fed BACK into that meeting
  // (reopen + inject a results report) for the team to converge the next decision.
  (db) => {
    db.exec("ALTER TABLE goals ADD COLUMN source_meeting_id TEXT NOT NULL DEFAULT '';");
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
