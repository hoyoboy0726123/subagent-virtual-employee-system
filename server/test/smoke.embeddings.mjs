// Hermetic checks for hybrid semantic retrieval (Milestone D2). A FAKE topic
// embedder is injected, so no 100 MB model is ever downloaded and the RRF fusion
// logic is exercised deterministically. The regression under test: enabling
// embeddings must (a) surface paraphrases that pure BM25/FTS misses, (b) never
// hurt exact-term hits, and (c) fall back cleanly to pure BM25 when nothing is
// embedded yet — the standalone-first contract.
// Run: part of `npm test`, or standalone `node server/test/smoke.embeddings.mjs`.
import assert from 'node:assert/strict';

// A throwaway in-memory DB, chosen BEFORE any config-backed module is imported.
process.env.DB_FILE = ':memory:';
delete process.env.EMBEDDINGS_ENABLED; // default OFF — we drive it via the override

const { insertEmployee } = await import('../src/storage/employees.repo.js');
const { insertDocument } = await import('../src/storage/knowledge.repo.js');
const { search } = await import('../src/storage/retrieval.js');
const { __setEmbedderForTest } = await import('../src/reasoning/embeddings.js');
const { embedPendingChunks } = await import('../src/reasoning/indexer.js');
const { embeddingStats } = await import('../src/storage/vector.js');

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A deterministic stand-in for a real sentence embedder: each text maps to a
// multi-hot vector over a few TOPICS. Words in the same topic are treated as
// semantically identical even when they share ZERO characters — which is exactly
// the case pure FTS cannot handle. embeddings.js L2-normalizes the result.
const TOPICS = [
  ['退款', '賠償', '退錢', '補償', '拿回錢'], // money-back (lexically disjoint synonyms)
  ['運費', '物流', '配送', '寄送'],           // shipping
  ['請假', '假期', '年假', '休假'],           // leave
];
const fakeEmbedder = {
  model: 'fake-topic-embedder',
  dim: TOPICS.length,
  embed: (texts) => texts.map((t) => TOPICS.map((words) => (words.some((w) => t.includes(w)) ? 1 : 0))),
};

const empId = insertEmployee({ name: '客服小美', roleTitle: '客服專員' }).id;

// Two knowledge docs whose topics are clear but whose wording does NOT overlap
// the query below.
const docA = insertDocument(empId, { title: '退款政策', content: '不良品可於七天內申請退款,全額退還。' });   // money-back
const docB = insertDocument(empId, { title: '配送規則', content: '偏遠地區將額外加收運費,由買方負擔。' }); // shipping

try {
  await step('baseline (embeddings OFF): a paraphrase query misses via pure FTS', async () => {
    // Query shares money-back MEANING with docA but no characters with it.
    const hits = await search({ query: '東西壞掉想要求賠償', employeeIds: [empId], limit: 4 });
    assert.ok(!hits.some((h) => h.documentId === docA.id),
      'pure BM25 cannot connect 賠償 → 退款 (no shared tokens) — this is the gap D2 closes');
  });

  await step('enabling embeddings with NO vectors yet still falls back to pure FTS (no crash)', async () => {
    __setEmbedderForTest(fakeEmbedder); // enabled, but nothing embedded yet
    const hits = await search({ query: '退款', employeeIds: [empId], limit: 4 });
    // 退款 is a literal token in docA, so FTS alone finds it; the point is the
    // hybrid path degrades gracefully when chunk_embeddings is empty.
    assert.ok(hits.some((h) => h.documentId === docA.id), 'exact term still found with zero vectors');
    __setEmbedderForTest(null);
  });

  await step('backfill embeds every pending chunk', async () => {
    __setEmbedderForTest(fakeEmbedder);
    const before = embeddingStats('fake-topic-embedder');
    assert.equal(before.embedded, 0, 'nothing embedded before backfill');
    const res = await embedPendingChunks();
    assert.ok(res.embedded >= 2, `backfill embedded the chunks (got ${res.embedded})`);
    const after = embeddingStats('fake-topic-embedder');
    assert.equal(after.missing, 0, 'no chunks left un-embedded');
  });

  await step('hybrid: the paraphrase query now surfaces docA via vector cosine', async () => {
    const hits = await search({ query: '東西壞掉想要求賠償', employeeIds: [empId], limit: 4 });
    assert.ok(hits.some((h) => h.documentId === docA.id),
      'semantic side connects 賠償 → 退款 that FTS missed');
    assert.ok(!hits.some((h) => h.documentId === docB.id),
      'the shipping doc (different topic) is NOT dragged in');
  });

  await step('hybrid: an exact-term query keeps its precise hit ranked first (RRF)', async () => {
    const hits = await search({ query: '退款 全額', employeeIds: [empId], limit: 4 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].documentId, docA.id, 'the doc strong in BOTH FTS and vector ranks first');
    assert.ok('rrfScore' in hits[0], 'hybrid results carry the fusion score');
  });

  await step('a query with no lexical tokens returns empty (unchanged contract)', async () => {
    const hits = await search({ query: '   , 。 !  ', employeeIds: [empId], limit: 4 });
    assert.deepEqual(hits, []);
  });

  __setEmbedderForTest(null); // leave global state clean for any later suite
  console.log(`\n  All ${passed} embedding/hybrid-retrieval checks passed ✅\n`);
} catch (err) {
  __setEmbedderForTest(null);
  console.error(`\n  ✗ embedding check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
