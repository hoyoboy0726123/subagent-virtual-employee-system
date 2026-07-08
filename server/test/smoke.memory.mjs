// Hermetic checks for memory consolidation (Milestone D3). No LLM key and no
// network: the deterministic offline merge is exercised directly, and the live
// merge path is exercised via an INJECTED `generate`. The invariants under test:
// consolidation must (a) merge + de-duplicate accumulated memories, (b) ARCHIVE
// the originals non-destructively (row + full text kept, but removed from
// retrieval), and (c) respect the auto-trigger threshold.
// Run: part of `npm test`, or standalone `node server/test/smoke.memory.mjs`.
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
delete process.env.EMBEDDINGS_ENABLED;
delete process.env.MEMORY_CONSOLIDATE_DISABLE;

const { insertEmployee } = await import('../src/storage/employees.repo.js');
const {
  insertDocument, getDocument, listDocuments,
  listMemoryDocuments, countActiveMemoryDocuments,
} = await import('../src/storage/knowledge.repo.js');
const { search } = await import('../src/storage/retrieval.js');
const { consolidateEmployeeMemories } = await import('../src/orchestration/MemoryConsolidator.js');

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const mem = (empId, content) => insertDocument(empId, {
  title: '會議記憶', content, source: 'memory', tags: ['memory', 'meeting'],
});

try {
  const empA = insertEmployee({ name: '客服小美', roleTitle: '客服專員' }).id;
  // Four accumulated memories: a duplicate line across two, and an evolving fact.
  const m1 = mem(empA, '我負責客服 SLA 的制定。\n退貨期限為 7 天。');            // oldest
  const m2 = mem(empA, '我負責客服 SLA 的制定。\n本季目標是把回覆時間縮短到 2 小時。'); // dup line
  mem(empA, '退貨期限已調整為 14 天。'); // part of the corpus; not asserted on directly
  const m4 = mem(empA, '我承諾在下週前完成 SLA 文件。');                          // newest

  await step('before consolidation, an original memory is retrievable', async () => {
    const hits = await search({ query: 'SLA', employeeIds: [empA], limit: 10 });
    const ids = hits.map((h) => h.documentId);
    assert.ok([m1.id, m2.id, m4.id].some((id) => ids.includes(id)), 'an original SLA memory surfaces via FTS');
  });

  let consolidated;
  await step('deterministic merge (no LLM): de-duplicates and reports method', async () => {
    const res = await consolidateEmployeeMemories(empA, { force: true });
    assert.equal(res.method, 'deterministic', 'no key → offline merge');
    assert.equal(res.mergedCount, 4);
    consolidated = res.consolidated;
    const dupLines = consolidated.content.split('\n').filter((l) => l.includes('我負責客服 SLA 的制定'));
    assert.equal(dupLines.length, 1, 'the line shared by two memories appears exactly once');
  });

  await step('originals are ARCHIVED, not deleted: row + full text survive with provenance', async () => {
    const orig = getDocument(m1.id);
    assert.ok(orig, 'the original row still exists');
    assert.equal(orig.metadata.archived, true, 'marked archived');
    assert.equal(orig.metadata.supersededBy, consolidated.id, 'points at the consolidated memory');
    assert.ok(orig.content.includes('退貨期限為 7 天'), 'the original text is preserved for audit/recovery');
  });

  await step('after consolidation only the merged memory is active + shown', async () => {
    assert.equal(countActiveMemoryDocuments(empA), 1, 'exactly one active memory remains');
    const active = listMemoryDocuments(empA);
    assert.equal(active[0].id, consolidated.id);
    const carded = listDocuments(empA).map((d) => d.id);
    assert.ok(carded.includes(consolidated.id), 'the consolidated memory shows on the card');
    assert.ok(!carded.includes(m1.id) && !carded.includes(m2.id), 'archived originals are hidden from the card');
  });

  await step('archived originals drop OUT of retrieval; the consolidated memory is in', async () => {
    const hits = await search({ query: 'SLA', employeeIds: [empA], limit: 10 });
    const ids = hits.map((h) => h.documentId);
    assert.ok(ids.includes(consolidated.id), 'the merged memory is retrievable');
    assert.ok(![m1.id, m2.id, m4.id].some((id) => ids.includes(id)), 'no archived original surfaces anymore');
  });

  await step('below threshold without force → skipped (auto-trigger gate)', async () => {
    const empB = insertEmployee({ name: '工程阿明', roleTitle: '後端工程師' }).id;
    mem(empB, '我維護訂單服務。');
    mem(empB, '我維護金流服務。');
    const res = await consolidateEmployeeMemories(empB); // no force; default threshold is 12
    assert.equal(res.skipped, 'below-threshold');
    assert.equal(res.count, 2);
    assert.equal(countActiveMemoryDocuments(empB), 2, 'nothing was archived');
  });

  await step('live merge path uses the injected model output (reconciled text)', async () => {
    const empC = insertEmployee({ name: '產品小華', roleTitle: '產品經理' }).id;
    mem(empC, '退貨期限為 7 天。');
    mem(empC, '退貨期限已改為 14 天。');
    const fakeGenerate = async () => ({ text: '我目前的政策:退貨期限為 14 天(已由 7 天調整)。' });
    const res = await consolidateEmployeeMemories(empC, { force: true, generate: fakeGenerate });
    assert.equal(res.method, 'live', 'an injected generate drives the live path even without a key');
    assert.ok(res.consolidated.content.includes('已由 7 天調整'), 'the model-reconciled memory is what gets stored');
    assert.equal(countActiveMemoryDocuments(empC), 1);
  });

  console.log(`\n  All ${passed} memory-consolidation checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ memory check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
