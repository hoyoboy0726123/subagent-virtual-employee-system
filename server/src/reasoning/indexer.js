// Embedding indexer (D2) — fills `chunk_embeddings` for chunks that don't yet
// have a vector for the active model. Two entry points:
//   • embedPendingChunks() — a bounded backfill loop (used by the setup script
//     and as the worker behind the incremental scheduler);
//   • scheduleEmbedding()  — fire-and-forget incremental indexing after a
//     knowledge write, single-flight so concurrent uploads don't stampede.
// Both are safe no-ops when embeddings are disabled or the model can't load, so
// callers can trigger them unconditionally (standalone-first).
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { embedder, embeddingsEnabled } from './embeddings.js';
import { upsertMany } from '../storage/vector.js';

let running = false; // single-flight guard for scheduleEmbedding
let rerun = false;   // a write arrived mid-run → do one more pass

// Chunks with no embedding for the CURRENT model (a model change re-indexes).
function pendingChunks(model, limit) {
  return getDb().prepare(`
    SELECT c.id AS chunkId, c.employee_id AS employeeId, c.content AS content
    FROM chunks c
    LEFT JOIN chunk_embeddings ce ON ce.chunk_id = c.id AND ce.model = ?
    WHERE ce.chunk_id IS NULL
    LIMIT ?
  `).all(model, limit);
}

/**
 * Embed every not-yet-embedded chunk, in batches.
 * @param {{signal?: AbortSignal, onProgress?: (n: number) => void}} [opts]
 * @returns {Promise<{embedded: number, unavailable?: boolean}>}
 */
export async function embedPendingChunks({ signal, onProgress } = {}) {
  if (!embeddingsEnabled()) return { embedded: 0, unavailable: true };
  if (!(await embedder.ready())) return { embedded: 0, unavailable: true };

  const model = embedder.model();
  const batch = Math.max(1, config.retrieval.embedding.batchSize);
  let embedded = 0;

  for (;;) {
    if (signal?.aborted) break;
    const rows = pendingChunks(model, batch);
    if (!rows.length) break;
    const vectors = await embedder.embed(rows.map((r) => r.content), { kind: 'passage' });
    if (!vectors) break; // became unavailable mid-run
    upsertMany(rows.map((r, i) => ({
      chunkId: r.chunkId, employeeId: r.employeeId, model, vector: vectors[i],
    })));
    embedded += rows.length;
    onProgress?.(embedded);
  }
  return { embedded };
}

/**
 * Incrementally index new chunks in the background. Returns immediately; never
 * throws. No-op when embeddings are off, so knowledge-write paths can call it
 * unconditionally. Single-flight: a call while a pass is running just marks a
 * rerun so the freshly-inserted chunks are picked up without overlapping work.
 */
export function scheduleEmbedding() {
  if (!embeddingsEnabled()) return;
  if (running) { rerun = true; return; }
  running = true;
  (async () => {
    try {
      do {
        rerun = false;
        await embedPendingChunks();
      } while (rerun);
    } catch (err) {
      console.warn(`[embeddings] 背景索引失敗:${err.message}`);
    } finally {
      running = false;
    }
  })();
}
