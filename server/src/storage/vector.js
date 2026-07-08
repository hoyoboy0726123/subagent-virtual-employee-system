// Vector store + pure-JS cosine backend for hybrid retrieval (D2).
//
// Chunk vectors (L2-normalized Float32) live in the `chunk_embeddings` table as
// BLOBs, so cosine similarity is just a dot product. Ranking scans the SCOPED
// candidate set in plain JS — no native extension — so it runs anywhere Node
// runs (arm64, fully standalone builds). For the target scale (a single team's
// knowledge base, scoped per employee) a linear scan is comfortably fast; the
// documented upgrade path when a corpus outgrows it is `sqlite-vec` (a pure
// SQLite ANN extension) behind this exact same interface.
import { getDb } from '../db/connection.js';
import { withTx } from '../db/tx.js';
import { now } from '../util/ids.js';

// A SQLite BLOB round-trips as a Uint8Array; pack/unpack Float32 vectors.
function toBlob(vec) {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}
function fromBlob(bytes) {
  // Copy the exact byte range into a fresh, 4-byte-aligned ArrayBuffer — the
  // stored Uint8Array may be a view into a larger, unaligned buffer.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(ab);
}

/** Insert or replace one embedding. */
export function upsertEmbedding({ chunkId, employeeId, model, vector }) {
  return upsertMany([{ chunkId, employeeId, model, vector }]);
}

/** Insert or replace many embeddings in one transaction. */
export function upsertMany(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const db = getDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO chunk_embeddings
      (chunk_id, employee_id, model, dim, vector, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
  const ts = now();
  withTx(db, () => {
    for (const r of rows) {
      const f32 = r.vector instanceof Float32Array ? r.vector : Float32Array.from(r.vector);
      stmt.run(r.chunkId, r.employeeId, r.model, f32.length, toBlob(f32), ts);
    }
  });
  return rows.length;
}

/** Does the (optionally employee-scoped) corpus have ANY vectors for `model`?
 *  Cheap gate so retrieval can skip loading the model when nothing is embedded. */
export function hasEmbeddings({ employeeIds, model } = {}) {
  const db = getDb();
  const scoped = Array.isArray(employeeIds) && employeeIds.length > 0;
  const ph = scoped ? employeeIds.map(() => '?').join(', ') : '';
  const sql = `SELECT 1 FROM chunk_embeddings
      WHERE model = ? ${scoped ? `AND employee_id IN (${ph})` : ''} LIMIT 1`;
  const params = scoped ? [model, ...employeeIds] : [model];
  return Boolean(db.prepare(sql).get(...params));
}

/** Corpus embedding stats (surfaced on health / used by the setup script). */
export function embeddingStats(model) {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  const embedded = model
    ? db.prepare('SELECT COUNT(*) AS n FROM chunk_embeddings WHERE model = ?').get(model).n
    : db.prepare('SELECT COUNT(*) AS n FROM chunk_embeddings').get().n;
  return { total, embedded, missing: Math.max(0, total - embedded) };
}

/**
 * Cosine-rank chunks against a query vector, scoped to employees.
 * @param {Float32Array|number[]} queryVec  L2-normalized query embedding
 * @param {{employeeIds?: string[], limit?: number, model: string}} opts
 * @returns {Array<{chunkId: string, score: number}>} best-first (score = cosine)
 */
export function vectorSearch(queryVec, { employeeIds, limit = 40, model } = {}) {
  const db = getDb();
  const scoped = Array.isArray(employeeIds) && employeeIds.length > 0;
  const ph = scoped ? employeeIds.map(() => '?').join(', ') : '';
  const sql = `SELECT chunk_id AS chunkId, dim, vector FROM chunk_embeddings
      WHERE model = ? ${scoped ? `AND employee_id IN (${ph})` : ''}`;
  const rows = db.prepare(sql).all(...(scoped ? [model, ...employeeIds] : [model]));

  const q = queryVec instanceof Float32Array ? queryVec : Float32Array.from(queryVec);
  const scored = [];
  for (const r of rows) {
    if (r.dim !== q.length) continue; // model/dim mismatch — skip, never mis-score
    const v = fromBlob(r.vector);
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i] * v[i];
    // Orthogonal/anti-correlated vectors aren't "hits" — never let a cosine ≤ 0
    // contribute a vector rank to fusion (it would drag unrelated docs in).
    if (dot > 1e-6) scored.push({ chunkId: r.chunkId, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
