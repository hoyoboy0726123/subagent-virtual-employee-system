// Retrieval layer — hybrid BM25 + vector, with a pure-BM25 fallback.
//
// The default is SQLite FTS5 + BM25 (exact terms, proper nouns). When semantic
// embeddings are enabled AND the scoped corpus has vectors, retrieval ALSO runs
// a cosine search and fuses the two ranked lists with Reciprocal Rank Fusion
// (RRF) — so paraphrases and near-synonyms surface without hurting exact-match
// precision. If embeddings are off, unavailable, or nothing is embedded yet, the
// result is byte-for-byte the pure-BM25 behaviour (standalone-first).
//
// `search()` and `groundingFor()` are async because computing the QUERY
// embedding is async; the returned shape is unchanged, and `score` keeps the
// "lower is better" convention (BM25 score, or negated RRF in hybrid mode) so
// existing sort call sites are untouched.
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
// CJK-aware query building lives in fts.js so the index side (knowledge.repo)
// and the query side stay symmetrical.
import { toMatchQuery } from './fts.js';
import { embeddingsEnabled, embedder } from '../reasoning/embeddings.js';
import { hasEmbeddings, vectorSearch } from './vector.js';

const emb = () => config.retrieval.embedding;

// --- BM25 / FTS side (the always-on baseline) -------------------------------

/** Keyword-rank chunks via FTS5 + BM25. Returns full rows, best-first (lowest
 *  bm25 score first). This is the exact query the module has always run. */
function ftsSearch({ query, employeeIds, limit }) {
  const match = toMatchQuery(query);
  if (!match) return [];

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
  const params = scoped ? [match, ...employeeIds, limit] : [match, limit];
  return getDb().prepare(sql).all(...params);
}

// Full row data for vector-only hits (chunks that ranked via cosine but not
// BM25), so fused results carry the same shape as ftsSearch rows.
function hydrateChunks(chunkIds) {
  if (!chunkIds.length) return [];
  const ph = chunkIds.map(() => '?').join(', ');
  return getDb().prepare(`
    SELECT
      c.id          AS chunkId,
      c.document_id AS documentId,
      d.title       AS documentTitle,
      c.employee_id AS employeeId,
      e.name        AS employeeName,
      c.content     AS content
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    JOIN employees e ON e.id = c.employee_id
    WHERE c.id IN (${ph})
  `).all(...chunkIds);
}

// --- Fusion -----------------------------------------------------------------

// Reciprocal Rank Fusion: each list contributes 1/(k + rank) per item; scores
// sum across lists. Robust to the two retrievers' incomparable score scales.
function rrfFuse(ftsHits, vecHits, { topK, k }) {
  const scores = new Map(); // chunkId → fused rrf score (higher = better)
  const add = (id, r) => scores.set(id, (scores.get(id) || 0) + 1 / (k + r + 1));
  ftsHits.forEach((h, i) => add(h.chunkId, i));
  vecHits.forEach((h, i) => add(h.chunkId, i));

  const rowById = new Map(ftsHits.map((h) => [h.chunkId, h]));
  const missing = vecHits.map((h) => h.chunkId).filter((id) => !rowById.has(id));
  for (const row of hydrateChunks(missing)) rowById.set(row.chunkId, row);

  return [...scores.entries()]
    .filter(([id]) => rowById.has(id)) // guard: a hit could have just been deleted
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    // Keep "lower score = better" so groundingFor's ascending sort is unchanged;
    // expose the raw fusion score too for anyone who wants higher-is-better.
    .map(([id, s]) => ({ ...rowById.get(id), score: -s, rrfScore: s }));
}

// --- Public API -------------------------------------------------------------

/**
 * Search knowledge chunks (hybrid when embeddings are on, else pure BM25).
 * @param {object} opts
 * @param {string}   opts.query          free text to match
 * @param {string[]} [opts.employeeIds]  restrict to these employees (RAG scoping)
 * @param {number}   [opts.limit]        max chunks to return
 * @returns {Promise<Array<{chunkId,documentId,documentTitle,employeeId,employeeName,content,score}>>}
 */
export async function search({ query, employeeIds, limit, _queryVector } = {}) {
  const topK = limit || config.retrieval.topK;
  if (!toMatchQuery(query)) {
    // No lexical tokens (e.g. a query of only stopwords/punctuation): the BM25
    // side can't run, so there is nothing to fuse against — return empty, same
    // as before. (Pure-semantic search over such queries is a future option.)
    return [];
  }

  // Pure-BM25 path: embeddings off, or the scoped corpus has no vectors yet.
  const model = embedder.model();
  const hybrid = embeddingsEnabled() && hasEmbeddings({ employeeIds, model });
  if (!hybrid) return ftsSearch({ query, employeeIds, limit: topK });

  const candidates = emb().candidates;
  const ftsHits = ftsSearch({ query, employeeIds, limit: candidates });

  // Embed the query (may lazily load the model), unless a caller already did it
  // (groundingFor embeds the shared query once). Any failure → pure BM25.
  let qvec = _queryVector;
  if (!qvec) {
    const vecs = await embedder.embed([query], { kind: 'query' });
    qvec = vecs && vecs[0];
  }
  if (!qvec) return ftsHits.slice(0, topK);

  const vecHits = vectorSearch(qvec, { employeeIds, limit: candidates, model });
  if (!vecHits.length) return ftsHits.slice(0, topK);

  return rrfFuse(ftsHits, vecHits, { topK, k: emb().rrfK });
}

/**
 * Build per-employee grounding for a set of employees against a query. Returns a
 * map of employeeId → up to `perEmployee` chunks, plus a flat de-duplicated list
 * suitable for storing on a meeting/goal record ("knowledge used").
 */
export async function groundingFor({ query, employees, perEmployee = 2, overall } = {}) {
  const byEmployee = {};
  const flat = [];
  const seen = new Set();
  const ids = employees.map((e) => e.id);

  // Embed the SHARED query once (if hybrid is active for this corpus) and thread
  // the vector through every scoped search, rather than re-embedding per employee
  // — one model call per meeting instead of N+1.
  let queryVector;
  if (embeddingsEnabled() && toMatchQuery(query)
      && hasEmbeddings({ employeeIds: ids, model: embedder.model() })) {
    const vecs = await embedder.embed([query], { kind: 'query' });
    queryVector = vecs && vecs[0];
  }

  // Per-employee pools (run concurrently — each is an independent hybrid search).
  const perLists = await Promise.all(
    employees.map((emp) => search({ query, employeeIds: [emp.id], limit: perEmployee, _queryVector: queryVector })),
  );
  employees.forEach((emp, i) => {
    const hits = perLists[i];
    byEmployee[emp.id] = hits;
    for (const h of hits) {
      if (seen.has(h.chunkId)) continue;
      seen.add(h.chunkId);
      flat.push(h);
    }
  });

  // Also pull a small pool across ALL selected employees so cross-cutting facts
  // surface even if no single employee ranks them highly.
  const shared = await search({ query, employeeIds: ids, limit: overall || config.retrieval.topK, _queryVector: queryVector });
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
