// Phase 13 agentic-tool-use unit checks. These exercise the toolbox and the
// agentic generation loop directly — no HTTP, no API key, no network:
// retrieval and the model are injected as fakes, so the checks are hermetic.
// Run: part of `npm test`, or standalone `node server/test/smoke.tools.mjs`.
import assert from 'node:assert/strict';

// The provider-aware llm layer may consult the settings store — keep that in
// memory so this test never touches a real database file.
process.env.DB_FILE = ':memory:';

const { buildToolbox, parseToolRequest, formatToolResult, webSearchEnabled } = await import('../src/reasoning/tools.js');
const { generateAgentic } = await import('../src/reasoning/llm.js');
const { config } = await import('../src/config.js');

let passed = 0;
function step(name, fn) {
  const r = fn();
  const done = () => { passed++; console.log(`  ✓ ${name}`); };
  return r instanceof Promise ? r.then(done) : done();
}

const employee = { id: 'emp_t', name: 'Ada Lin', roleTitle: '資料科學家' };

// Fake retrieval: returns one hit for "SLA", nothing otherwise.
const fakeSearch = ({ query }) =>
  /sla/i.test(query)
    ? [{ documentTitle: '客服手冊', content: '標準 SLA 為 24 小時內首次回覆。', chunkId: 'c1' }]
    : [];

try {
  await step('parseToolRequest accepts bare JSON, fenced JSON, and leading-line JSON', () => {
    assert.deepEqual(
      parseToolRequest('{"tool":"search_knowledge","args":{"query":"SLA"}}'),
      { tool: 'search_knowledge', args: { query: 'SLA' } });
    assert.deepEqual(
      parseToolRequest('```json\n{"tool":"web_search","args":{"query":"法規"}}\n```'),
      { tool: 'web_search', args: { query: '法規' } });
    assert.equal(parseToolRequest('我認為 SLA 應該是 24 小時。'), null, 'prose is not a tool request');
    assert.equal(
      parseToolRequest('我認為在設計這套工具呼叫協議的時候應該要特別小心不要誤判發言，例如像這種順口提到的範例格式 {"tool":"x"} 就不該被當成呼叫'),
      null, 'JSON deep in a sentence (preamble > lead-in threshold) is speech, not a tool call');
    // Real CLI-model shapes: short lead-in / trailing sentence / nested args.
    assert.deepEqual(
      parseToolRequest('好的，我先查：{"tool":"web_search","args":{"query":"最新法規"}}'),
      { tool: 'web_search', args: { query: '最新法規' } }, 'short lead-in before the JSON is accepted');
    assert.deepEqual(
      parseToolRequest('{"tool":"search_knowledge","args":{"query":"SLA","limit":3}} 查完再回報。'),
      { tool: 'search_knowledge', args: { query: 'SLA', limit: 3 } }, 'trailing sentence + nested args parse');
  });

  await step('toolbox: search_knowledge is scoped to the employee and records honest hits', async () => {
    const tb = buildToolbox({ employee, searchKnowledge: fakeSearch });
    assert.ok(tb.declarations.some((d) => d.name === 'search_knowledge'));
    const res = await tb.execute('search_knowledge', { query: '客服 SLA' });
    assert.equal(res.hits.length, 1);
    assert.equal(res.hits[0].documentTitle, '客服手冊');
    assert.deepEqual(tb.trace.map((t) => [t.tool, t.ok]), [['search_knowledge', true]]);
    assert.equal(tb.knowledgeHits().length, 1, 'looked-up chunks become citation candidates');
    const empty = await tb.execute('search_knowledge', { query: '完全無關' });
    assert.equal(empty.hits.length, 0);
    assert.ok(formatToolResult('search_knowledge', empty).includes('沒有'), 'empty result is stated honestly');
  });

  await step('toolbox: web_search stays out of the toolbox unless a provider key is configured', async () => {
    assert.equal(webSearchEnabled(), false, 'hermetic run has no web-search key');
    const tb = buildToolbox({ employee, searchKnowledge: fakeSearch });
    assert.ok(!tb.declarations.some((d) => d.name === 'web_search'), 'standalone-first: tool not offered');
    assert.equal(tb.policy, '', 'no attribution policy when web search is off');
    const res = await tb.execute('web_search', { query: 'x' });
    assert.ok(res.error, 'direct call reports it is disabled instead of hitting the network');
  });

  await step('toolbox: web_search uses Tavily ADVANCED depth and tracks sources for attribution', async () => {
    let captured = null;
    const fakeFetch = async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return {
        ok: true,
        json: async () => ({
          results: [
            { title: '產業報告 A', url: 'https://a.example.com', content: 'A 內容片段' },
            { title: '新聞 B', url: 'https://b.example.com', content: 'B 內容片段' },
          ],
        }),
      };
    };
    const tb = buildToolbox({ employee, searchKnowledge: fakeSearch, fetchImpl: fakeFetch, _webEnabled: true });
    assert.ok(tb.declarations.some((d) => d.name === 'web_search'), 'tool offered when gate is open');
    assert.ok(tb.policy.includes('出處'), 'attribution policy rides with the toolbox');

    const res = await tb.execute('web_search', { query: '電商物流趨勢' });
    assert.equal(captured.body.search_depth, 'advanced', 'deep search is on');
    assert.equal(captured.body.chunks_per_source, 3, 'multiple snippets per source (advanced-only)');
    assert.ok(captured.init.headers.authorization.startsWith('Bearer '), 'Tavily bearer auth');
    assert.equal(res.results.length, 2);
    assert.deepEqual(tb.webSources().map((s) => s.url),
      ['https://a.example.com', 'https://b.example.com'],
      'every consulted source is tracked for honest citations');
    assert.ok(formatToolResult('web_search', res).includes('出處'), 'result block reminds the agent to attribute');
  });

  await step('generateAgentic (native function calling — Gemma 4+/Gemini path): search then speak', async () => {
    const tb = buildToolbox({ employee, searchKnowledge: fakeSearch });
    const seen = [];
    const fake = async ({ contents }) => {
      seen.push(contents);
      return seen.length === 1
        ? { text: null, functionCalls: [{ name: 'search_knowledge', args: { query: 'SLA' } }] }
        : { text: '根據客服手冊，SLA 是 24 小時內首次回覆，我建議以此為驗收基準。', functionCalls: [] };
    };
    const res = await generateAgentic({
      system: 'persona', user: '請發言', toolbox: tb, _generate: fake, _legacyProtocol: false,
    });
    assert.ok(res.text.includes('24 小時'), 'final utterance uses what the tool returned');
    assert.equal(res.toolCalls, 1);
    const responseTurn = seen[1].find((c) => c.parts?.some((p) => p.functionResponse));
    assert.ok(responseTurn, 'tool result was sent back as a functionResponse turn');
    const payload = JSON.stringify(responseTurn);
    assert.ok(payload.includes('客服手冊') && payload.includes('24 小時內首次回覆'),
      'the retrieved hit itself is what the agent observes');
  });

  await step('generateAgentic (legacy Gemma 1–3 prompt protocol): search then speak', async () => {
    const tb = buildToolbox({ employee, searchKnowledge: fakeSearch });
    const prompts = [];
    const fake = async ({ user }) => {
      prompts.push(user);
      return prompts.length === 1
        ? { text: '{"tool":"search_knowledge","args":{"query":"SLA"}}', functionCalls: [] }
        : { text: '根據客服手冊，SLA 是 24 小時內首次回覆，我建議以此為驗收基準。', functionCalls: [] };
    };
    const res = await generateAgentic({
      system: 'persona', user: '請發言', toolbox: tb, _generate: fake, _legacyProtocol: true,
    });
    assert.ok(res.text.includes('24 小時'), 'final utterance uses what the tool returned');
    assert.equal(res.toolCalls, 1);
    assert.ok(prompts[1].includes('客服手冊'), 'tool result was fed back into the follow-up prompt');
    assert.ok(prompts[1].includes('標準 SLA'), 'the retrieved snippet itself is visible to the agent');
  });

  await step('generateAgentic: loop is bounded and repeated identical calls are refused (both paths)', async () => {
    for (const legacy of [false, true]) {
      const tb = buildToolbox({ employee, searchKnowledge: fakeSearch });
      const fake = async () => (legacy
        ? { text: '{"tool":"search_knowledge","args":{"query":"SLA"}}', functionCalls: [] }
        : { text: null, functionCalls: [{ name: 'search_knowledge', args: { query: 'SLA' } }] });
      const res = await generateAgentic({
        system: 'p', user: 'u', toolbox: tb, _generate: fake, _legacyProtocol: legacy,
      });
      assert.equal(res, null, 'a model that never stops asking for tools falls back cleanly');
      assert.equal(tb.trace.length, 1, `identical call executed once, not ${config.tools.maxCallsPerTurn}+ times`);
    }
  });

  await step('toolbox: remember persists a fact into the agent\'s own knowledge base', async () => {
    const saved = [];
    const tb = buildToolbox({
      employee,
      searchKnowledge: fakeSearch,
      saveMemory: (empId, data) => { saved.push({ empId, data }); return { title: data.title }; },
    });
    assert.ok(tb.declarations.some((d) => d.name === 'remember'), 'remember is always offered');
    const res = await tb.execute('remember', { title: 'SLA 基準', fact: '客服 SLA 為 24 小時內首次回覆。' });
    assert.equal(res.saved, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].empId, employee.id, 'writes to THIS agent\'s knowledge base only');
    assert.equal(saved[0].data.source, 'memory');
    const bad = await tb.execute('remember', { title: '', fact: '' });
    assert.ok(bad.error, 'empty memory is refused');
  });

  await step('toolbox: per-agent webSearch=false forbids the tool even when globally enabled', async () => {
    const restricted = { ...employee, agentConfig: { webSearch: false } };
    const tb = buildToolbox({ employee: restricted, searchKnowledge: fakeSearch, _webEnabled: true });
    assert.ok(!tb.declarations.some((d) => d.name === 'web_search'), 'agent-level permission wins');
    assert.ok(tb.declarations.some((d) => d.name === 'search_knowledge'), 'knowledge search unaffected');
    const res = await tb.execute('web_search', { query: 'x' });
    assert.ok(res.error, 'direct call is refused for this agent');
  });

  await step('generateAgentic: an agent that does not need tools just speaks (zero overhead)', async () => {
    const tb = buildToolbox({ employee, searchKnowledge: fakeSearch });
    const fake = async () => ({ text: '我直接表達立場：先守住體驗再談轉換。', functionCalls: [] });
    const res = await generateAgentic({ system: 'p', user: 'u', toolbox: tb, _generate: fake });
    assert.equal(res.toolCalls, 0);
    assert.ok(res.text.startsWith('我直接'));
  });

  await step('api-key test connections: injected transports, sanitized errors, no network', async () => {
    const { testTavilyKey, testGeminiKey } = await import('../src/reasoning/apiKeys.js');

    // Tavily: 200 → ok; 401 → clear invalid-key hint; upstream error message
    // containing the key is sanitized before it reaches the caller.
    const ok = await testTavilyKey('test-key-abc', { fetchImpl: async () => ({ ok: true }) });
    assert.deepEqual(ok, { ok: true });
    const unauth = await testTavilyKey('test-key-abc', { fetchImpl: async () => ({ ok: false, status: 401 }) });
    assert.equal(unauth.ok, false);
    assert.ok(unauth.error.includes('金鑰無效'));
    const leaky = await testTavilyKey('test-key-abc', {
      fetchImpl: async () => { throw new Error('bad request for key test-key-abc'); },
    });
    assert.ok(!leaky.error.includes('test-key-abc'), 'the key never echoes back through an error');
    assert.ok(leaky.error.includes('［金鑰］'));

    // Gemini: a successful tiny generation → ok + model id; failures → ok:false.
    const gOk = await testGeminiKey('test-key-g', {
      clientFactory: () => ({ models: { generateContent: async () => ({ text: 'pong' }) } }),
    });
    assert.equal(gOk.ok, true);
    assert.equal(gOk.model, config.llm.model);
    const gBad = await testGeminiKey('test-key-g', {
      clientFactory: () => ({ models: { generateContent: async () => { throw new Error('API key not valid: test-key-g'); } } }),
    });
    assert.equal(gBad.ok, false);
    assert.ok(!gBad.error.includes('test-key-g'), 'sanitized');

    // No key anywhere → honest local failure, transport never touched.
    const none = await testTavilyKey('', { fetchImpl: async () => { throw new Error('MUST NOT be called'); } });
    assert.deepEqual(none, { ok: false, error: '未提供金鑰' });
  });

  console.log(`\n  All ${passed} agentic-tool checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
