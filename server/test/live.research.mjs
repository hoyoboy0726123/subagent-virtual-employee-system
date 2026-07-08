// LIVE autonomous-research integration test (Phase 14) — proves the full
// "agent 自己去找資料回來" pipeline against the REAL services:
//   an employee agent + real Gemma 4 + real Tavily ADVANCED search
//   → multiple self-directed web queries
//   → a Traditional Chinese investigation report with a 資料來源 section
//   → stored PENDING → manager approval → ingested into the knowledge base
//   → retrievable via FTS like any other document.
//
// Spends real API quota; NOT part of `npm test`.
// Run: GEMINI_API_KEY=… TAVILY_API_KEY=… npm run test:live:research
import assert from 'node:assert/strict';

// Isolated in-memory DB BEFORE importing anything that touches the database.
process.env.DB_FILE = ':memory:';

const { llmEnabled } = await import('../src/reasoning/llm.js');
const { webSearchConfigured, WEB_SEARCH_SETTING_KEY } = await import('../src/reasoning/tools.js');
const { setSetting } = await import('../src/storage/settings.repo.js');
const { insertEmployee } = await import('../src/storage/employees.repo.js');
const research = await import('../src/services/research.service.js');
const { search } = await import('../src/storage/retrieval.js');

if (!llmEnabled() || !webSearchConfigured()) {
  console.error('  ✗ GEMINI_API_KEY and TAVILY_API_KEY are both required for the live research test.');
  process.exit(1);
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}\n`);
}

try {
  const emp = insertEmployee({
    name: 'Rita Kao',
    roleTitle: '市場研究員',
    expertise: ['市場分析', '產業研究'],
    personality: '嚴謹、重視資料來源',
  });

  await step('research is gated on the in-app toggle even with both keys present', async () => {
    await assert.rejects(
      () => research.runResearch(emp.id, '任何主題'),
      /網路搜尋開關/,
      'toggle off → clear Traditional Chinese error',
    );
    setSetting(WEB_SEARCH_SETTING_KEY, '1'); // manager flips the switch
  });

  let report;
  await step('agent researches the web ON ITS OWN and writes an attributed report', async () => {
    report = await research.runResearch(emp.id, 'AI agent 多代理協作系統在 2026 年的最新發展趨勢');
    console.log(`    queries the agent chose: ${JSON.stringify(report.queries)}`);
    console.log(`    sources consulted: ${report.sources.length}`);
    console.log(`    --- report excerpt ---\n${report.report.slice(0, 400).replace(/^/gm, '    ')}\n    ---`);
    assert.equal(report.status, 'pending', 'report awaits manager review');
    assert.ok(report.queries.length >= 1, 'agent ran self-directed web searches');
    assert.ok(report.sources.length >= 1, 'consulted sources are recorded');
    assert.ok(report.report.includes('## 摘要'), 'structured report');
    assert.ok(report.report.includes('資料來源'), 'report carries a sources section');
    assert.ok(/https?:\/\//.test(report.report), 'sources are cited with URLs in the report body');
  });

  await step('manager approval ingests the report into the knowledge base (retrievable via FTS)', async () => {
    const { report: approved, document } = research.approveResearch(report.id);
    assert.equal(approved.status, 'approved');
    assert.ok(document.chunkCount > 0, 'report was chunked for retrieval');

    const hits = await search({ query: 'AI agent 協作 趨勢', employeeIds: [emp.id], limit: 4 });
    assert.ok(hits.some((h) => h.documentId === document.id),
      'the approved research is now real, retrievable knowledge for this employee');
  });

  console.log(`  All ${passed} LIVE research checks passed ✅ — 研究 → 審核 → 入庫 全流程為真。\n`);
} catch (err) {
  console.error(`\n  ✗ live research check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
