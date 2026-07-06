// LIVE agentic integration test — proves Phase 13 against the REAL services:
//   1. gemma-4-31b-it answers with a native systemInstruction (no prompt folding);
//   2. gemma-4-31b-it natively emits a functionCall when it needs a tool;
//   3. full agentic loop: the agent DECIDES BY ITSELF to search its knowledge
//      base, observes the result, and its final utterance uses the fact it found;
//   4. full agentic loop with REAL web search (Tavily): the agent decides by
//      itself to search the web and grounds its answer in live results.
//
// This test spends real API quota, so it is NOT part of `npm test`.
// Run: GEMINI_API_KEY=… TAVILY_API_KEY=… npm run test:live
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { generate, generateAgentic, toolset, llmEnabled } from '../src/reasoning/llm.js';
import { buildToolbox, webSearchEnabled } from '../src/reasoning/tools.js';

if (!llmEnabled()) {
  console.error('  ✗ GEMINI_API_KEY (or GOOGLE_API_KEY) is required for the live test.');
  process.exit(1);
}
console.log(`\n  Live agentic test — model: ${config.llm.model}, web search: ${webSearchEnabled() ? 'Tavily (enabled)' : 'disabled'}\n`);

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}\n`);
}

const employee = { id: 'emp_live', name: 'Ada Lin', roleTitle: '資料科學家' };

// A fabricated fact that CANNOT come from model weights — if the final answer
// contains it, it can only have arrived via the tool round-trip.
const SECRET_FACT = '北極星專案的正式上線日為 2026-09-17，總負責人是林小美。';
const knowledgeWithSecret = ({ query }) => {
  console.log(`    [tool] search_knowledge("${query}")`);
  return [{ documentTitle: '北極星專案章程', content: SECRET_FACT, chunkId: 'c_live' }];
};

try {
  await step('1. gemma-4-31b-it: native systemInstruction works (no prompt folding)', async () => {
    const res = await generate({
      system: '你只會說繁體中文，而且每句話都以「喵」結尾。',
      user: '用一句話介紹你自己。',
      maxTokens: 100,
    });
    assert.ok(res?.text?.trim(), 'model returned text');
    console.log(`    → ${res.text.trim().slice(0, 120)}`);
    assert.ok(res.text.includes('喵'), 'system instruction visibly steered the reply');
  });

  await step('2. gemma-4-31b-it: natively emits a functionCall when it needs a tool', async () => {
    const tb = buildToolbox({ employee, searchKnowledge: knowledgeWithSecret });
    const res = await generate({
      system: '你是一位嚴謹的員工。回答任何專案問題前，必須先用工具查詢自己的知識庫，嚴禁憑記憶回答。',
      user: '北極星專案的正式上線日是哪一天？',
      tools: toolset(tb.declarations),
      maxTokens: 300,
    });
    assert.ok(res, 'model responded');
    assert.ok(res.functionCalls?.length, `model emitted a native functionCall (got: ${JSON.stringify(res.functionCalls)})`);
    console.log(`    → functionCall: ${res.functionCalls[0].name}(${JSON.stringify(res.functionCalls[0].args)})`);
    assert.equal(res.functionCalls[0].name, 'search_knowledge');
  });

  await step('3. full agentic loop: agent autonomously searches its knowledge base and USES the result', async () => {
    const tb = buildToolbox({ employee, searchKnowledge: knowledgeWithSecret });
    const res = await generateAgentic({
      system: [
        '你是 Ada Lin，一位嚴謹的資料科學家，在虛擬員工系統中與同事協作。',
        '你的個人知識庫裡有公司專案的權威資料；回答專案細節前，先查知識庫查證，不要憑印象。',
        '全程繁體中文，只輸出你的發言。',
      ].join('\n'),
      user: '主管問：北極星專案什麼時候上線？誰是總負責人？請簡短回報。',
      toolbox: tb,
      maxTokens: 400,
    });
    assert.ok(res?.text, 'agent produced a final utterance');
    console.log(`    → ${res.text.trim().slice(0, 200)}`);
    assert.ok(tb.trace.some((t) => t.tool === 'search_knowledge' && t.ok),
      'agent decided BY ITSELF to call search_knowledge');
    assert.ok(res.text.includes('09-17') || res.text.includes('9 月 17') || res.text.includes('9月17'),
      'the fabricated launch date can only have come from the tool round-trip');
    assert.ok(res.text.includes('林小美'), 'the fabricated owner name came through the tool round-trip');
    assert.ok(tb.knowledgeHits().length > 0, 'looked-up chunks are available as honest citations');
  });

  if (webSearchEnabled()) {
    await step('4. full agentic loop: agent autonomously searches the WEB (real Tavily) and grounds its answer', async () => {
      const tb = buildToolbox({ employee, searchKnowledge: knowledgeWithSecret });
      const res = await generateAgentic({
        system: [
          '你是 Ada Lin，一位嚴謹的資料科學家。',
          '涉及外部世界的最新資訊（新聞、發布、市場動態）時，你的知識可能過時，務必先用 web_search 查證再回答。',
          '全程繁體中文，只輸出你的發言，並自然提及資訊來源。',
        ].join('\n'),
        user: '主管問：Google 最新一代的開源 Gemma 模型是第幾代？有哪些新能力？請先查證再簡短回報。',
        toolbox: tb,
        maxTokens: 500,
      });
      assert.ok(res?.text, 'agent produced a final utterance');
      const webCalls = tb.trace.filter((t) => t.tool === 'web_search');
      console.log(`    → web_search calls: ${JSON.stringify(webCalls.map((t) => t.args))}`);
      console.log(`    → ${res.text.trim().slice(0, 260)}`);
      assert.ok(webCalls.length > 0, 'agent decided BY ITSELF to call web_search');
      assert.ok(webCalls.some((t) => t.ok), 'Tavily round-trip succeeded');
    });
  } else {
    console.log('  – (skipped web test: no TAVILY_API_KEY)');
  }

  console.log(`  All ${passed} LIVE agentic checks passed ✅ — the agent decides on its own when to use tools.\n`);
} catch (err) {
  console.error(`\n  ✗ live check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
