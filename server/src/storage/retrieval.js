// Retrieval layer (simple RAG, keyword/FTS for now).
//
// Ranks knowledge chunks against a query using SQLite FTS5 + BM25, scoped to one
// or many employees. This is the seam where a future vector/embedding retriever
// would slot in behind the same `search()` signature — routes and the runtime
// only depend on the returned shape, not on how ranking is done.
import { getDb } from '../db/connection.js';
import { config } from '../config.js';

// Turn arbitrary user text into a safe FTS5 MATCH expression: extract word
// tokens, drop stopword-length fragments, and OR them together quoted (quoting
// neutralizes FTS operator characters so free text can never be a syntax error).
function toMatchQuery(text) {
  const terms = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const uniq = [...new Set(terms)].filter((t) => t.length > 1).slice(0, 24);
  if (!uniq.length) return null;
  return uniq.map((t) => `"${t}"`).join(' OR ');
}

/**
 * Keyword-search knowledge chunks.
 * @param {object} opts
 * @param {string} opts.query          free text to match
 * @param {string[]} [opts.employeeIds] restrict to these employees (RAG scoping)
 * @param {number} [opts.limit]        max chunks to return
 * @returns {Array<{chunkId,documentId,documentTitle,employeeId,employeeName,content,score}>}
 */
export function search({ query, employeeIds, limit } = {}) {
  const match = toMatchQuery(query);
  if (!match) return [];
  const topK = limit || config.retrieval.topK;

  const scoped = Array.isArray(employeeIds) && employeeIds.length > 0;
  const placeholders = scoped ? employeeIds.map(() => '?').join(', ') : '';

  const sql = `
    SELECT
      f.chunk_id      AS chunkId,
      c.document_id   AS documentId,
      d.title         AS documentTitle,
      f.employee_id   AS employeeId,
      e.name          AS employeeName,
      f.content       AS content,
      bm25(chunks_fts) AS score
    FROM chunks_fts f
    JOIN chunks    c ON c.id = f.chunk_id
    JOIN documents d ON d.id = c.document_id
    JOIN employees e ON e.id = f.employee_id
    WHERE chunks_fts MATCH ?
      ${scoped ? `AND f.employee_id IN (${placeholders})` : ''}
    ORDER BY bm25(chunks_fts) ASC
    LIMIT ?
  `;

  const params = scoped ? [match, ...employeeIds, topK] : [match, topK];
  return getDb().prepare(sql).all(...params);
}

/**
 * Build per-employee grounding for a set of employees against a query. Returns a
 * map of employeeId → up to `perEmployee` chunks, plus a flat de-duplicated list
 * suitable for storing on a meeting/goal record ("knowledge used").
 */
export function groundingFor({ query, employees, perEmployee = 2, overall } = {}) {
  const byEmployee = {};
  const flat = [];
  const seen = new Set();

  for (const emp of employees) {
    const hits = search({ query, employeeIds: [emp.id], limit: perEmployee });
    byEmployee[emp.id] = hits;
    for (const h of hits) {
      if (seen.has(h.chunkId)) continue;
      seen.add(h.chunkId);
      flat.push(h);
    }
  }

  // Also pull a small pool across ALL selected employees so cross-cutting facts
  // surface even if no single employee ranks them highly.
  const ids = employees.map((e) => e.id);
  const shared = search({ query, employeeIds: ids, limit: overall || config.retrieval.topK });
  for (const h of shared) {
    if (seen.has(h.chunkId)) continue;
    seen.add(h.chunkId);
    flat.push(h);
  }

  flat.sort((a, b) => a.score - b.score);
  return { byEmployee, flat };
}

// Corpus stats (surfaced on the health endpoint).
export function retrievalStats() {
  const db = getDb();
  return {
    documents: db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
    chunks: db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n,
  };
}
