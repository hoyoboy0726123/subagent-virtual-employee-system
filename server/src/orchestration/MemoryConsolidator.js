// MemoryConsolidator (D3) — keeps organizational memory from piling up forever.
//
// After every meeting an employee gains a `source:'memory'` document (its stance,
// commitments, team decisions), plus anything it chose to `remember`. Left alone
// these accumulate without bound, overlap heavily, and eventually CONTRADICT each
// other ("我負責退貨政策" from March vs. a reassignment in June). Consolidation
// periodically MERGES an employee's active memories into ONE compact, de-duplicated
// memory that reconciles contradictions by recency — then ARCHIVES the originals
// (non-destructive: their rows + full text survive, only their retrieval chunks
// are removed, with a `supersededBy` pointer) so the consolidated memory is the
// single thing retrieval and grounding see going forward.
//
// LLM does the semantic merge (one call); a deterministic line-dedupe is the
// offline fallback, so consolidation works with zero API keys too. Both are
// idempotent-friendly: a prior consolidated doc is itself an input to the next
// pass (and gets archived by it), so exactly one active consolidated memory
// remains plus an auditable trail of archived originals.
// MEMORY_CONSOLIDATE_DISABLE=1 turns the whole feature off.
import { generate as generateDefault, llmEnabled } from '../reasoning/llm.js';
import {
  insertDocument,
  listMemoryDocuments,
  countActiveMemoryDocuments,
  archiveDocumentChunks,
} from '../storage/knowledge.repo.js';
import { scheduleEmbedding } from '../reasoning/indexer.js';
import { normalizeTraditional } from './output.js';
import { config } from '../config.js';

const disabled = () => config.memory.consolidateDisabled;

const CONSOLIDATE_SYSTEM = [
  '你是組織記憶的整併者。以下是同一位員工日積月累的多則記憶,依時間由舊到新排列,彼此可能重複、過時或互相矛盾。',
  '請把它們合併成一份精簡、無重複、無矛盾的記憶,規則:',
  '1) 相同或近似的事實只保留一則;',
  '2) 前後矛盾時採用「較新」的版本,若該事實有演變意義,可用一句話註明演變(例如「退貨期限已由 7 天調整為 14 天」);',
  '3) 保留仍然有效的承諾、負責事項與團隊決議,捨棄已被取代或明顯過時的內容;',
  '以第一人稱(「我」)、具體、繁體中文,分點輸出;只輸出整併後的記憶本身,不要前言或說明。',
].join('\n');

// Deterministic offline merge: newest-first, drop duplicate lines (normalized),
// keep original ordering otherwise. Not semantic, but bounded and honest.
function deterministicMerge(mems) {
  const seen = new Set();
  const lines = [];
  for (const m of [...mems].reverse()) { // newest memories win on duplicates
    for (const raw of String(m.content || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const key = normalizeTraditional(line.replace(/^[-*・\d.、）)\s]+/, ''));
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join('\n');
}

/**
 * Consolidate one employee's active memory documents into a single merged memory.
 * @param {string} employeeId
 * @param {{force?: boolean, generate?: Function}} [opts]
 *   force — ignore the count threshold (manual trigger). generate — injectable
 *   model call (hermetic tests).
 * @returns {Promise<{consolidated?: object, mergedCount?: number, method?: string, skipped?: string, count?: number}>}
 */
export async function consolidateEmployeeMemories(employeeId, { force = false, generate = generateDefault } = {}) {
  if (disabled()) return { skipped: 'disabled' };

  const mems = listMemoryDocuments(employeeId); // active, oldest→newest
  if (!force && mems.length < config.memory.consolidateThreshold) {
    return { skipped: 'below-threshold', count: mems.length };
  }
  if (mems.length < 2) return { skipped: 'nothing-to-merge', count: mems.length };

  let content = null;
  let method = 'deterministic';
  // Use the model when the live brain is on — or whenever a caller injects its own
  // `generate` (hermetic tests), so the merge path is exercisable without a key.
  const useLlm = generate !== generateDefault || llmEnabled();
  if (useLlm) {
    const body = mems
      .map((m, i) => `【記憶 ${i + 1}｜${String(m.createdAt).slice(0, 10)}】\n${m.content}`)
      .join('\n\n');
    const res = await generate({ system: CONSOLIDATE_SYSTEM, user: body, maxTokens: config.llm.output.summary, temperature: 0.3 });
    content = res?.text?.trim() || null;
    if (content) method = 'live';
  }
  if (!content) content = deterministicMerge(mems);
  if (!content) return { skipped: 'empty', count: mems.length };

  // Write the consolidated memory FIRST (it is a fresh, non-archived memory doc),
  // then archive every source it merged. Order matters: if archiving failed the
  // consolidated doc still exists, so no memory is ever lost.
  const doc = insertDocument(employeeId, {
    title: '整併記憶',
    content: normalizeTraditional(content),
    source: 'memory',
    tags: ['memory', 'consolidated'],
    metadata: {
      consolidated: true,
      method,
      mergedCount: mems.length,
      mergedFrom: mems.map((m) => m.id),
      at: new Date().toISOString(),
    },
  });
  for (const m of mems) archiveDocumentChunks(m.id, { archived: true, supersededBy: doc.id });
  scheduleEmbedding(); // index the consolidated memory (no-op unless embeddings on)

  return { consolidated: doc, mergedCount: mems.length, method };
}

// Single-flight guard so back-to-back meetings don't launch overlapping passes
// for the same employee.
const inFlight = new Set();

/**
 * Fire-and-forget background consolidation after a memory write. No-op when the
 * feature is off or the employee is still under the threshold, so callers can
 * invoke it unconditionally. Never throws.
 */
export function scheduleConsolidation(employeeId) {
  if (disabled() || inFlight.has(employeeId)) return;
  let count = 0;
  try { count = countActiveMemoryDocuments(employeeId); } catch { return; }
  if (count < config.memory.consolidateThreshold) return;

  inFlight.add(employeeId);
  (async () => {
    try {
      await consolidateEmployeeMemories(employeeId);
    } catch (err) {
      console.warn(`[memory] 整併失敗:${err.message}`);
    } finally {
      inFlight.delete(employeeId);
    }
  })();
}
