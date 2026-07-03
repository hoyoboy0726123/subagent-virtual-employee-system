// Storage layer: knowledge documents + chunks + FTS index.
//
// Writing a document is transactional: we insert the document, chunk its text,
// insert each chunk, and mirror every chunk into the FTS5 index. Deleting a
// document (or employee) removes its chunks via cascade, but FTS5 virtual tables
// don't honor foreign keys, so we clear their FTS rows explicitly here.
import { getDb } from '../db/connection.js';
import { withTx } from '../db/tx.js';
import { id, now } from '../util/ids.js';
import { chunkText } from '../reasoning/chunk.js';

const parseJson = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

// The knowledge API historically exposed notes as {id, employeeId, title,
// content, tags, createdAt}. We keep that exact shape for backward compat and
// add the richer document fields (source, metadata, chunkCount) alongside.
function rowToDocument(row, chunkCount) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    title: row.title,
    content: row.content,
    source: row.source,
    tags: parseJson(row.tags, []),
    metadata: parseJson(row.metadata, {}),
    chunkCount: chunkCount ?? undefined,
    createdAt: row.created_at,
  };
}

export function listDocuments(employeeId) {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM documents WHERE employee_id = ? ORDER BY created_at ASC')
    .all(employeeId);
  const counts = db
    .prepare('SELECT document_id, COUNT(*) AS n FROM chunks GROUP BY document_id')
    .all()
    .reduce((m, r) => ((m[r.document_id] = r.n), m), {});
  return rows.map((r) => rowToDocument(r, counts[r.id] || 0));
}

export function getDocument(documentId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!row) return null;
  const n = db
    .prepare('SELECT COUNT(*) AS n FROM chunks WHERE document_id = ?')
    .get(documentId).n;
  return rowToDocument(row, n);
}

export function insertDocument(employeeId, data) {
  const db = getDb();
  const doc = {
    id: id('doc'),
    employeeId,
    title: data.title || 'Untitled note',
    content: String(data.content || ''),
    source: data.source || 'note',
    tags: Array.isArray(data.tags) ? data.tags : [],
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    createdAt: now(),
  };

  const chunks = chunkText(doc.content);

  withTx(db, () => {
    db.prepare(`INSERT INTO documents
        (id, employee_id, title, content, source, tags, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        doc.id, doc.employeeId, doc.title, doc.content, doc.source,
        JSON.stringify(doc.tags), JSON.stringify(doc.metadata), doc.createdAt,
      );

    const insChunk = db.prepare(`INSERT INTO chunks
        (id, document_id, employee_id, chunk_index, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
    const insFts = db.prepare(
      'INSERT INTO chunks_fts (content, chunk_id, employee_id) VALUES (?, ?, ?)',
    );

    chunks.forEach((content, i) => {
      const chunkId = id('chk');
      insChunk.run(chunkId, doc.id, doc.employeeId, i, content, doc.createdAt);
      insFts.run(content, chunkId, doc.employeeId);
    });
  });

  return { ...doc, chunkCount: chunks.length };
}

export function deleteDocument(documentId) {
  const db = getDb();
  return withTx(db, () => {
    const chunkIds = db
      .prepare('SELECT id FROM chunks WHERE document_id = ?')
      .all(documentId)
      .map((r) => r.id);
    const delFts = db.prepare('DELETE FROM chunks_fts WHERE chunk_id = ?');
    for (const cid of chunkIds) delFts.run(cid);
    const info = db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
    return info.changes;
  }) > 0;
}
