// End-to-end smoke test. Boots the real Express app on an ephemeral port and
// exercises every core flow against live HTTP — now including SQLite-backed
// persistence, knowledge chunking + FTS retrieval, employee-scoped search, the
// runtime adapter switch, and knowledge-grounded meetings/goals.
// No external services needed. Run: `npm test`.
import assert from 'node:assert/strict';

// Use an isolated in-memory database BEFORE importing the app so the smoke test
// never touches seeded/real data. Also pin the provider and strip any API keys
// from the developer's shell — assertions here rely on a keyless baseline
// (see _hermetic.mjs for the fuller story).
process.env.DB_FILE = ':memory:';
process.env.LLM_PROVIDER = 'google';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.TAVILY_API_KEY;
delete process.env.WEB_SEARCH_API_KEY;
// Force the document-ingestion pipeline onto its built-in JS fallback so this
// test is hermetic regardless of whether MarkItDown (Python) is installed on the
// machine. The REAL MarkItDown path is exercised by the opt-in
// test/smoke.markitdown.mjs (it needs Python + the markitdown package).
process.env.MARKITDOWN_DISABLE = '1';
// Keep the long-standing knowledge-count assertions stable: meeting-memory
// distillation is off by default here and turned on inside its dedicated step
// (the flag is read per call, so toggling process.env mid-test works).
process.env.MEETING_MEMORY_DISABLE = '1';
const { app } = await import('../src/index.js');

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const api = async (method, pathname, body) => {
  const res = await fetch(base + pathname, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  // ALWAYS consume the body — an unread body keeps its pooled undici
  // connection busy; enough of them deadlocks the next fetch (Linux CI hang).
  const isJson = res.headers.get('content-type')?.includes('json');
  const json = isJson ? await res.json() : (await res.arrayBuffer().catch(() => {}), null);
  return { status: res.status, json };
};

// Multipart upload of an in-memory buffer — used to exercise knowledge-file
// ingestion. Content-Type is left to the browser/undici (multipart boundary).
const upload = async (pathname, { filename, content, type }) => {
  const fd = new FormData();
  fd.append('file', new Blob([content], type ? { type } : undefined), filename);
  const res = await fetch(base + pathname, { method: 'POST', body: fd });
  const isJson = res.headers.get('content-type')?.includes('json');
  const json = isJson ? await res.json() : (await res.arrayBuffer().catch(() => {}), null);
  return { status: res.status, json };
};

// Raw fetch that keeps headers + bytes — used to assert file downloads.
const download = async (pathname) => {
  const res = await fetch(base + pathname);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition') || '',
    buf,
  };
};

try {
  await step('health check reports SQLite counts + standalone runtime', async () => {
    const { status, json } = await api('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.ok('documents' in json.counts && 'chunks' in json.counts, 'exposes kb stats');
    assert.equal(json.runtime, 'standalone', 'default runtime is standalone (no external deps)');
    assert.ok(json.standalone, 'health exposes the standalone runtime block');
    // No API key in the hermetic test → agent turns run on the offline engine.
    assert.equal(json.standalone.engine, 'deterministic');
  });

  let empId;
  await step('create employee (auto-generates profile)', async () => {
    const { status, json } = await api('POST', '/api/employees', {
      name: 'Test Persona',
      roleTitle: 'QA Engineer',
      expertise: ['testing', 'automation'],
      personality: 'meticulous',
      communicationStyle: 'precise',
    });
    assert.equal(status, 201);
    assert.ok(json.id);
    assert.ok(json.profile.includes('Test Persona'), 'profile mentions the name');
    empId = json.id;
  });

  await step('reject employee without required fields', async () => {
    const { status } = await api('POST', '/api/employees', { name: 'No Role' });
    assert.equal(status, 400);
  });

  await step('ideate a role from a description (Traditional Chinese output)', async () => {
    const { status, json } = await api('POST', '/api/employees/ideate', {
      description: 'someone to run our marketing campaigns and content',
    });
    assert.equal(status, 200);
    assert.equal(json.roleTitle, '行銷主管');
    assert.ok(json.profile.length > 20);
  });

  let empId2;
  await step('create a second employee', async () => {
    const { json } = await api('POST', '/api/employees', {
      name: 'Second Persona', roleTitle: 'Designer', expertise: ['ux', 'figma'],
    });
    empId2 = json.id;
  });

  let docId;
  await step('add a knowledge document (chunked + indexed)', async () => {
    const { status, json } = await api('POST', `/api/employees/${empId}/knowledge`, {
      title: 'Regression policy',
      content: 'Always run the full regression suite before a release. Flaky tests must be quarantined, never deleted. Every bug fix ships with a covering test that fails before the fix and passes after.',
      tags: ['qa', 'policy'],
    });
    assert.equal(status, 201);
    assert.equal(json.employeeId, empId);
    assert.ok(json.chunkCount >= 1, 'document was chunked');
    docId = json.id;
  });

  await step('knowledge shows on employee detail', async () => {
    const { json } = await api('GET', `/api/employees/${empId}`);
    assert.equal(json.knowledge.length, 1);
    assert.equal(json.knowledge[0].id, docId);
  });

  await step('health now counts documents + chunks', async () => {
    const { json } = await api('GET', '/api/health');
    assert.ok(json.counts.documents >= 1);
    assert.ok(json.counts.chunks >= 1);
  });

  await step('keyword retrieval finds the chunk', async () => {
    const { status, json } = await api('GET', '/api/knowledge/search?q=regression%20flaky%20tests');
    assert.equal(status, 200);
    assert.ok(json.results.length >= 1, 'got a hit');
    assert.equal(json.results[0].documentTitle, 'Regression policy');
  });

  await step('retrieval can be scoped to an employee', async () => {
    // Scoped to the OTHER employee (who has no docs) → no hits.
    const { json } = await api('GET', `/api/knowledge/search?q=regression&employeeIds=${empId2}`);
    assert.equal(json.results.length, 0, 'scoping excludes other employees');
    const { json: mine } = await api('GET', `/api/knowledge/search?q=regression&employeeIds=${empId}`);
    assert.ok(mine.results.length >= 1, 'scoped to owner returns the hit');
  });

  // --- Phase 7: document upload → Markdown → chunk/index (built-in fallback) ---
  await step('health advertises the ingestion capability + supported types', async () => {
    const { json } = await api('GET', '/api/health');
    assert.ok(json.ingest, 'health exposes an ingest block');
    for (const t of ['pdf', 'docx', 'txt', 'md', 'html']) {
      assert.ok(json.ingest.supportedTypes.includes(t), `supports ${t}`);
    }
    // MarkItDown is force-disabled here → the fallback is what runs.
    assert.equal(json.ingest.markitdown.available, false, 'MarkItDown disabled in the hermetic test');
    assert.ok(json.ingest.maxBytes > 0, 'exposes an upload size cap');
  });

  let uploadDocId;
  await step('upload a TXT file → parsed to Markdown, chunked + indexed', async () => {
    const { status, json } = await upload(`/api/employees/${empId2}/knowledge/upload`, {
      filename: 'onboarding.txt',
      type: 'text/plain',
      content: 'Deployments freeze on Fridays. Incident retros are blameless and shipped within two business days.',
    });
    assert.equal(status, 201);
    assert.equal(json.source, 'file', 'stored as a file-sourced document');
    assert.equal(json.metadata.sourceType, 'txt');
    assert.equal(json.metadata.originalFilename, 'onboarding.txt');
    assert.equal(json.metadata.parseStatus, 'fallback', 'used the built-in extractor');
    assert.ok(json.metadata.parser.startsWith('builtin'), 'parser is the built-in one');
    assert.ok(json.chunkCount >= 1, 'the uploaded file was chunked');
    uploadDocId = json.id;
  });

  await step('uploaded file is retrievable like a pasted note', async () => {
    const { json } = await api('GET', `/api/knowledge/search?q=deployments%20freeze&employeeIds=${empId2}`);
    assert.ok(json.results.length >= 1, 'the uploaded doc is searchable');
    assert.equal(json.results[0].documentId, uploadDocId);
  });

  await step('upload a Markdown file → section-aware chunking preserves headings', async () => {
    const { status, json } = await upload(`/api/employees/${empId2}/knowledge/upload`, {
      filename: 'runbook.md',
      type: 'text/markdown',
      content: '# Runbook\n\n## Rollback\nRevert the release tag and redeploy the prior build.\n\n## Escalation\nPage the on-call SRE after ten minutes of downtime.',
    });
    assert.equal(status, 201);
    assert.equal(json.metadata.sourceType, 'md');
    assert.ok(json.chunkCount >= 2, 'markdown split into multiple sections');
    // A section heading term should retrieve its section, breadcrumb-prefixed.
    const { json: hit } = await api('GET', `/api/knowledge/search?q=Escalation&employeeIds=${empId2}`);
    assert.ok(hit.results.length >= 1, 'heading term retrieves its section');
    assert.ok(hit.results.some((r) => r.content.includes('Runbook')), 'chunk carries its heading breadcrumb');
  });

  await step('upload an HTML file → tags stripped to Markdown', async () => {
    const { status, json } = await upload(`/api/employees/${empId2}/knowledge/upload`, {
      filename: 'policy.html',
      type: 'text/html',
      content: '<html><body><h1>Security Policy</h1><p>Rotate <strong>all</strong> API keys every ninety days.</p></body></html>',
    });
    assert.equal(status, 201);
    assert.equal(json.metadata.sourceType, 'html');
    assert.ok(/Security Policy/.test(json.content), 'heading survived extraction');
    assert.ok(!/<[a-z]/i.test(json.content), 'html tags were stripped');
  });

  await step('binary upload without MarkItDown fails with a clear error', async () => {
    // PDF needs MarkItDown; with it disabled the guardrail returns a 4xx.
    const { status, json } = await upload(`/api/employees/${empId2}/knowledge/upload`, {
      filename: 'report.pdf',
      type: 'application/pdf',
      content: '%PDF-1.4 not-really-a-pdf',
    });
    assert.ok(status === 422 || status === 400, 'binary-without-parser is rejected');
    assert.ok(json.error && json.error.length > 0, 'surfaces a Traditional Chinese error');
  });

  await step('unsupported file type is rejected', async () => {
    const { status } = await upload(`/api/employees/${empId2}/knowledge/upload`, {
      filename: 'malware.exe',
      type: 'application/octet-stream',
      content: 'MZ',
    });
    assert.equal(status, 400, 'unknown type → 400');
  });

  await step('uploaded knowledge shows on employee detail then cleans up', async () => {
    const { json } = await api('GET', `/api/employees/${empId2}`);
    assert.ok(json.knowledge.length >= 3, 'txt + md + html are all listed');
    // Remove the uploads so later assertions about empId2 stay predictable.
    for (const k of json.knowledge) await api('DELETE', `/api/knowledge/${k.id}`);
    const { json: after } = await api('GET', `/api/employees/${empId2}`);
    assert.equal(after.knowledge.length, 0, 'uploads removed');
  });

  let meetingId;
  await step('run a meeting → transcript/minutes/report + grounding', async () => {
    const { status, json } = await api('POST', '/api/meetings', {
      topic: 'Regression and release readiness',
      participantIds: [empId, empId2],
      rounds: 3,
    });
    assert.equal(status, 201);
    meetingId = json.id;
    assert.equal(json.transcript.length, 6, '2 participants x 3 rounds');
    assert.ok(json.minutes.actionItems.length >= 2);
    assert.ok(json.report.includes('Regression and release readiness'));
    assert.ok(Array.isArray(json.grounding), 'grounding attached');
    assert.ok(json.grounding.length >= 1, 'meeting was grounded in retrieved knowledge');
    assert.equal(json.runtime.mode, 'standalone');
    // Multi-agent orchestration ran; without an API key every turn used the
    // offline engine, which is honestly flagged (not presented as a live model).
    assert.equal(json.runtime.engine, 'deterministic');
    assert.equal(json.runtime.live, false);
    assert.ok(json.runtime.totalTurns >= 6, 'a turn per participant per round was orchestrated');
  });

  await step('reject meeting without participants', async () => {
    const { status } = await api('POST', '/api/meetings', { topic: 'Empty' });
    assert.equal(status, 400);
  });

  let goalId;
  await step('assign a goal → tasks + collaboration output', async () => {
    const { status, json } = await api('POST', '/api/goals', {
      title: 'Ship the beta',
      description: 'Get the beta into 10 teams by Friday with a clean regression run.',
      assigneeIds: [empId, empId2],
    });
    assert.equal(status, 201);
    goalId = json.id;
    assert.equal(json.tasks.length, 2);
    assert.equal(json.status, 'in-progress');
    assert.ok(json.output.includes('Ship the beta'));
    assert.equal(json.runtime.mode, 'standalone');
  });

  await step('export meeting report as .docx (valid OOXML + filename)', async () => {
    const { status, contentType, disposition, buf } = await download(`/api/meetings/${meetingId}/export`);
    assert.equal(status, 200);
    assert.ok(contentType.includes('wordprocessingml'), 'docx mime type');
    assert.ok(/attachment/.test(disposition) && /\.docx/.test(disposition), 'attachment .docx filename');
    assert.ok(/filename\*=UTF-8''/.test(disposition), 'RFC 5987 UTF-8 filename for non-ASCII titles');
    // OOXML files are ZIP archives → must start with the "PK" magic bytes.
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'docx body is a real ZIP/OOXML package');
    assert.ok(buf.length > 1000, 'non-trivial document produced');
  });

  await step('export meeting report as Markdown', async () => {
    const { status, contentType, buf } = await download(`/api/meetings/${meetingId}/export?format=md`);
    assert.equal(status, 200);
    assert.ok(contentType.includes('markdown'), 'markdown mime type');
    const md = buf.toString('utf-8');
    assert.ok(md.includes('會議報告'), 'has the report title');
    assert.ok(md.includes('Regression and release readiness'), 'includes the topic');
    assert.ok(md.includes('## 逐字紀錄'), 'includes the transcript section');
  });

  await step('export goal collaboration output as .docx', async () => {
    const { status, contentType, disposition, buf } = await download(`/api/goals/${goalId}/export`);
    assert.equal(status, 200);
    assert.ok(contentType.includes('wordprocessingml'), 'docx mime type');
    assert.ok(/協作成果/.test(decodeURIComponent(disposition)), 'goal filename prefix');
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'valid OOXML package');
  });

  await step('export of a missing report → 404', async () => {
    const { status } = await download('/api/meetings/mtg_does_not_exist/export');
    assert.equal(status, 404);
  });

  await step('runtime is standalone-only (OpenClaw removed in Phase 17)', async () => {
    const { json } = await api('GET', '/api/health');
    assert.equal(json.runtime, 'standalone');
    assert.equal(json.openclaw, undefined, 'no openclaw block anymore');

    const { json: mtg } = await api('POST', '/api/meetings', {
      topic: 'Runtime sanity check', participantIds: [empId], rounds: 1,
    });
    assert.equal(mtg.runtime.mode, 'standalone');
    assert.equal(mtg.runtime.engine, 'deterministic', 'no key → honest offline engine');
    await api('DELETE', `/api/meetings/${mtg.id}`);

    // Settings PUT ignores retired keys and keeps working for live ones.
    const { status, json: s } = await api('PUT', '/api/settings', { runtimeMode: 'openclaw' });
    assert.equal(status, 200);
    assert.equal(s.runtimeMode, undefined, 'runtime switching is gone from the settings API');
    assert.ok(s.webSearch, 'web-search settings still reported');
  });

  await step('brain selector: providers listed with status; switching is validated', async () => {
    const { json: s } = await api('GET', '/api/settings');
    const ids = s.llm.providers.map((p) => p.id);
    assert.deepEqual(ids, ['google', 'claude-cli', 'codex-cli'], 'all three brains are listed');
    for (const p of s.llm.providers) {
      assert.ok(typeof p.selectable === 'boolean' && typeof p.detail === 'string' && p.label,
        'each brain reports availability + a human-readable reason');
    }
    assert.equal(s.llm.providers.find((p) => p.id === 'google').selectable, true,
      'google is always selectable (offline engine without a key)');

    const bad = await api('PUT', '/api/settings', { llmProvider: 'nonsense' });
    assert.equal(bad.status, 400, 'unknown brain is rejected');

    const ok = await api('PUT', '/api/settings', { llmProvider: 'google' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.llm.provider, 'google');
    assert.equal(ok.json.llm.providers.find((p) => p.id === 'google').active, true);
  });

  await step('per-agent config: persisted, sanitized, and editable', async () => {
    const { status, json: created } = await api('POST', '/api/employees', {
      name: 'Config Test', roleTitle: '測試員',
      agentConfig: { model: 'gemini-2.5-flash', temperature: 0.3, webSearch: false, maxToolCalls: 5, bogus: 'x' },
    });
    assert.equal(status, 201);
    assert.deepEqual(created.agentConfig, { model: 'gemini-2.5-flash', temperature: 0.3, webSearch: false, maxToolCalls: 5 },
      'known keys persist; unknown keys are dropped');

    const { json: fetched } = await api('GET', `/api/employees/${created.id}`);
    assert.deepEqual(fetched.agentConfig, created.agentConfig, 'survives a fresh read');

    const { json: updated } = await api('PUT', `/api/employees/${created.id}`, { agentConfig: { temperature: 9 } });
    assert.deepEqual(updated.agentConfig, {}, 'out-of-range values are dropped → inherit defaults');

    await api('DELETE', `/api/employees/${created.id}`);
  });

  await step('CJK retrieval: Chinese substring queries now match (segmented FTS)', async () => {
    const { json: doc } = await api('POST', `/api/employees/${empId}/knowledge`, {
      title: '客服政策',
      content: '我們的退貨政策是七天內免費退換貨，超過期限需酌收處理費。物流合作夥伴為黑貓宅急便。',
    });
    const q1 = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('退貨')}&employeeIds=${empId}`);
    assert.ok(q1.json.results.some((r) => r.documentId === doc.id), '2-char Chinese word「退貨」matches');
    const q2 = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('物流 夥伴')}&employeeIds=${empId}`);
    assert.ok(q2.json.results.some((r) => r.documentId === doc.id), 'multi-term Chinese query matches');
    await api('DELETE', `/api/knowledge/${doc.id}`);
  });

  await step('D1: long CJK compound queries match paraphrases (bigram recall)', async () => {
    // Doc writes the compound SPLIT (退貨...的政策); the old exact-phrase query
    // required 退貨政策 contiguous and would miss this.
    const { json: doc } = await api('POST', `/api/employees/${empId}/knowledge`, {
      title: '客服規範', content: '關於退貨，我們的政策是七天鑑賞期；至於客戶滿意度，追蹤機制每月檢討。',
    });
    const split = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('退貨政策')}&employeeIds=${empId}`);
    assert.ok(split.json.results.some((r) => r.documentId === doc.id),
      '「退貨政策」matches a doc that wrote 「退貨...的政策」 (bigram recall)');

    // And an EXACT contiguous compound still matches (and ranks — precision kept).
    const { json: doc2 } = await api('POST', `/api/employees/${empId}/knowledge`, {
      title: '滿意度', content: '客戶滿意度指標是本季重點。',
    });
    const exact = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('客戶滿意度')}&employeeIds=${empId}`);
    assert.ok(exact.json.results[0]?.documentId === doc2.id, 'exact compound still ranks first');

    await api('DELETE', `/api/knowledge/${doc.id}`);
    await api('DELETE', `/api/knowledge/${doc2.id}`);
  });

  await step('SSE streaming: a meeting streams round/turn events live, then done', async () => {
    const res = await fetch(`${base}/api/meetings/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '串流驗證會議', participantIds: [empId], rounds: 2 }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/event-stream'));
    assert.equal(res.headers.get('x-accel-buffering'), 'no', 'C2: tells nginx not to buffer the SSE stream');

    const events = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(i + 2);
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    }
    const types = events.map((e) => e.type);
    assert.ok(types.filter((t) => t === 'round').length === 2, 'one round event per round');
    assert.ok(types.filter((t) => t === 'turn').length === 2, 'one turn event per agent turn');
    assert.ok(types.includes('synthesizing'), 'synthesis phase is announced');
    assert.equal(types[types.length - 1], 'done', 'stream ends with done');
    const finalEvt = events[events.length - 1];
    assert.ok(finalEvt.meeting?.id, 'done carries the persisted meeting');
    assert.equal(finalEvt.meeting.transcript.length, 2);
    assert.ok(events.find((e) => e.type === 'turn').turn.text.length > 0, 'turn events carry real utterances');
    await api('DELETE', `/api/meetings/${finalEvt.meeting.id}`);
  });

  await step('SSE streaming: goal assignees run in PARALLEL and stream task completions', async () => {
    const { json: e2 } = await api('POST', '/api/employees', { name: 'Parallel Pat', roleTitle: '行銷' });
    const res = await fetch(`${base}/api/goals/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '平行驗證目標', assigneeIds: [empId, e2.id] }),
    });
    assert.equal(res.status, 200);
    const chunks = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    const events = chunks.join('').split('\n\n').filter(Boolean)
      .map((f) => f.split('\n').find((l) => l.startsWith('data: ')))
      .filter(Boolean)
      .map((l) => JSON.parse(l.slice(6)));
    const types = events.map((e) => e.type);
    assert.equal(types.filter((t) => t === 'task').length, 2, 'each assignee streams a task event');
    assert.equal(types[types.length - 1], 'done');
    const goal = events[events.length - 1].goal;
    assert.equal(goal.tasks.length, 2);
    assert.deepEqual(goal.tasks.map((t) => t.order), [1, 2], 'task order is stable despite parallel execution');
    await api('DELETE', `/api/goals/${goal.id}`);
    await api('DELETE', `/api/employees/${e2.id}`);
  });

  await step('manager-chaired lifecycle: discuss → interject → continue → conclude', async () => {
    const readSse = async (pathname, body) => {
      const res = await fetch(base + pathname, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const text = await res.text();
      return text.split('\n\n').filter(Boolean)
        .map((f) => f.split('\n').find((l) => l.startsWith('data: ')))
        .filter(Boolean).map((l) => JSON.parse(l.slice(6)));
    };

    // 1) Start a discussion — it must STOP without minutes/report.
    const events = await readSse('/api/meetings/discuss/stream', {
      topic: '主管主持流程驗證', participantIds: [empId], rounds: 1,
    });
    const done = events[events.length - 1];
    assert.equal(done.type, 'done');
    const m = done.meeting;
    assert.equal(m.status, 'discussing', 'meeting waits for the manager');
    assert.equal(m.report, '', 'no report until the manager concludes');
    assert.equal(m.transcript.length, 1);

    // 2) Manager interjects (stored — no live segment running).
    const inj = await api('POST', '/api/meetings/interject', { meetingId: m.id, text: '先聚焦成本，暫緩討論新功能。' });
    assert.equal(inj.status, 200);
    assert.equal(inj.json.delivery, 'stored');

    // 3) Continue one more round — transcript carries over, manager turn included.
    const contEvents = await readSse(`/api/meetings/${m.id}/continue/stream`, { rounds: 1 });
    const cont = contEvents[contEvents.length - 1].meeting;
    assert.equal(cont.status, 'discussing');
    assert.ok(cont.transcript.some((t) => t.isManager && t.text.includes('先聚焦成本')), 'manager turn is in the record');
    assert.ok(cont.transcript.filter((t) => !t.isManager).length >= 2, 'a new employee round ran');
    assert.equal(cont.transcript.filter((t) => !t.isManager).slice(-1)[0].round, 2, 'round numbering continues');

    // 4) Concluding is refused twice / produces artifacts once.
    const concEvents = await readSse(`/api/meetings/${m.id}/conclude/stream`, {});
    const concluded = concEvents[concEvents.length - 1].meeting;
    assert.equal(concluded.status, 'concluded');
    assert.ok(concluded.report.length > 0, 'report exists only after the manager concluded');
    assert.ok(concluded.minutes.attendees, 'minutes synthesized');

    const again = await readSse(`/api/meetings/${m.id}/conclude/stream`, {});
    assert.equal(again[again.length - 1].type, 'error', 'double conclusion is refused');

    // 5) Interjecting a concluded meeting is refused.
    const lateInj = await api('POST', '/api/meetings/interject', { meetingId: m.id, text: 'x' });
    assert.equal(lateInj.status, 400);

    // 6) REOPEN (mirrors the 1on1): concluded → discussing on the SAME
    // transcript; discussion continues; the next 作結 replaces the report.
    const priorTurns = concluded.transcript.length;
    const reopened = await api('POST', `/api/meetings/${m.id}/reopen`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.status, 'discussing', 'concluded → discussing');
    assert.equal(reopened.json.transcript.length, priorTurns, 'transcript intact');
    const idem = await api('POST', `/api/meetings/${m.id}/reopen`);
    assert.equal(idem.json.status, 'discussing', 'reopen is idempotent while discussing');

    const moreEvents = await readSse(`/api/meetings/${m.id}/continue/stream`, { rounds: 1 });
    const more = moreEvents[moreEvents.length - 1].meeting;
    assert.ok(more.transcript.length > priorTurns, 'discussion continued on the same record');

    const reconcEvents = await readSse(`/api/meetings/${m.id}/conclude/stream`, {});
    const reconc = reconcEvents[reconcEvents.length - 1].meeting;
    assert.equal(reconc.status, 'concluded');
    assert.ok(reconc.report.length > 0, 're-conclusion regenerates the report from the full transcript');

    await api('DELETE', `/api/meetings/${m.id}`);
  });

  await step('1-on-1 dialogue: unlimited turns, then the manager decides whether to save', async () => {
    // Open (and resume — a second open returns the same session).
    const { status, json: d } = await api('POST', `/api/employees/${empId}/dialogue`);
    assert.equal(status, 201);
    assert.equal(d.status, 'open');
    const { json: resumed } = await api('POST', `/api/employees/${empId}/dialogue`);
    assert.equal(resumed.id, d.id, 'open dialogues resume instead of forking');

    // Multiple turns — no limit; each manager message gets an employee reply.
    const one = await api('POST', `/api/dialogues/${d.id}/messages`, { text: '目前回歸測試的規劃你怎麼看？' });
    assert.equal(one.status, 200);
    assert.equal(one.json.transcript.length, 2);
    assert.equal(one.json.transcript[1].who, 'employee');
    assert.ok(one.json.transcript[1].text.length > 10, 'employee gives a substantive reply');

    const two = await api('POST', `/api/dialogues/${d.id}/messages`, { text: '那風險最大的部分是什麼？' });
    const three = await api('POST', `/api/dialogues/${d.id}/messages`, { text: '好，先做一版計畫給我。' });
    assert.equal(three.json.transcript.length, 6, 'turns keep accumulating');
    assert.ok(two.json.transcript[3].text !== three.json.transcript[5].text, 'replies are not one canned string');

    // Close WITH save → distilled record lands in the knowledge base.
    const closed = await api('POST', `/api/dialogues/${d.id}/close`, { save: true });
    assert.equal(closed.status, 200);
    assert.equal(closed.json.status, 'closed');
    assert.equal(closed.json.saved, true);
    const { json: emp } = await api('GET', `/api/employees/${empId}`);
    const doc = emp.knowledge.find((k) => k.id === closed.json.savedDocId);
    assert.ok(doc, 'record saved to the knowledge base');
    assert.equal(doc.source, 'dialogue');
    assert.ok(doc.title.startsWith('1on1 紀錄'), 'titled as a 1on1 record');

    // A closed dialogue takes no more messages; double-close refused.
    const late = await api('POST', `/api/dialogues/${d.id}/messages`, { text: 'x' });
    assert.equal(late.status, 400);
    const again = await api('POST', `/api/dialogues/${d.id}/close`, { save: false });
    assert.equal(again.status, 400);

    // Close WITHOUT save → no knowledge doc.
    const { json: d2 } = await api('POST', `/api/employees/${empId}/dialogue`);
    await api('POST', `/api/dialogues/${d2.id}/messages`, { text: '隨便聊聊。' });
    const discarded = await api('POST', `/api/dialogues/${d2.id}/close`, { save: false });
    assert.equal(discarded.json.saved, false);
    assert.equal(discarded.json.savedDocId, null);

    await api('DELETE', `/api/knowledge/${closed.json.savedDocId}`);
  });

  await step('1-on-1 reopen: a closed dialogue continues; re-saving replaces its record', async () => {
    // A conversation, saved and closed.
    const { json: d } = await api('POST', `/api/employees/${empId}/dialogue`);
    await api('POST', `/api/dialogues/${d.id}/messages`, { text: '先討論產品定位。' });
    const first = await api('POST', `/api/dialogues/${d.id}/close`, { save: true });
    assert.equal(first.json.saved, true);
    const firstDocId = first.json.savedDocId;

    // Reopen → SAME dialogue, transcript intact, conversation continues.
    const reopened = await api('POST', `/api/dialogues/${d.id}/reopen`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.id, d.id, 'same conversation, not a fork');
    assert.equal(reopened.json.status, 'open');
    assert.equal(reopened.json.transcript.length, 2, 'history is intact');
    const more = await api('POST', `/api/dialogues/${d.id}/messages`, { text: '再補充一點:通路策略。' });
    assert.equal(more.json.transcript.length, 4, 'new turns append to the old transcript');

    // Close-and-save AGAIN → the knowledge base holds exactly ONE record for
    // this dialogue: the fresh distillation REPLACES the earlier one.
    const second = await api('POST', `/api/dialogues/${d.id}/close`, { save: true });
    assert.equal(second.json.saved, true);
    assert.notEqual(second.json.savedDocId, firstDocId, 'a fresh record was written');
    const { json: emp } = await api('GET', `/api/employees/${empId}`);
    const records = emp.knowledge.filter((k) => k.metadata?.dialogueId === d.id);
    assert.equal(records.length, 1, 'no duplicate 1on1 records after re-save');
    assert.equal(records[0].id, second.json.savedDocId);

    // Reopen + close WITHOUT save keeps the earlier record (pointer preserved,
    // so a future save still replaces instead of duplicating).
    await api('POST', `/api/dialogues/${d.id}/reopen`);
    const noSave = await api('POST', `/api/dialogues/${d.id}/close`, { save: false });
    assert.equal(noSave.json.saved, false);
    assert.equal(noSave.json.savedDocId, second.json.savedDocId, 'earlier record is not orphaned');

    // Reopen is refused while ANOTHER dialogue is open for the same employee…
    const { json: blocker } = await api('POST', `/api/employees/${empId}/dialogue`);
    const refused = await api('POST', `/api/dialogues/${d.id}/reopen`);
    assert.equal(refused.status, 400, 'one open dialogue per employee');
    // …and closing an EMPTY dialogue deletes it instead of littering history.
    const gone = await api('POST', `/api/dialogues/${blocker.id}/close`, { save: false });
    assert.equal(gone.json.discarded, true);
    const { json: list } = await api('GET', `/api/employees/${empId}/dialogues`);
    assert.ok(!list.some((x) => x.id === blocker.id), 'empty dialogue leaves no trace');

    await api('DELETE', `/api/knowledge/${second.json.savedDocId}`);
    await api('DELETE', `/api/dialogues/${d.id}`);
  });

  await step('1-on-1 export: record downloads as .docx and Markdown (open or closed)', async () => {
    const { json: d } = await api('POST', `/api/employees/${empId}/dialogue`);
    await api('POST', `/api/dialogues/${d.id}/messages`, { text: '把回歸測試計畫整理給我。' });

    // Markdown export while the dialogue is still OPEN.
    const md = await download(`/api/dialogues/${d.id}/export?format=md`);
    assert.equal(md.status, 200);
    assert.ok(md.contentType.includes('markdown'));
    const body = md.buf.toString('utf-8');
    assert.ok(body.includes('# 面談紀錄'), 'titled as a 1on1 record');
    assert.ok(body.includes('## 逐字紀錄') && body.includes('**主管**'), 'verbatim transcript included');
    assert.ok(body.includes('回歸測試計畫'), 'the actual conversation is in the export');

    // Close WITH save → the distilled record leads the export.
    const closed = await api('POST', `/api/dialogues/${d.id}/close`, { save: true });
    const md2 = (await download(`/api/dialogues/${d.id}/export?format=md`)).buf.toString('utf-8');
    assert.ok(md2.includes('## 整理後紀錄'), 'saved distillation leads the document');

    // Word export: a real OOXML zip with a clean attachment filename.
    const docx = await download(`/api/dialogues/${d.id}/export?format=docx`);
    assert.equal(docx.status, 200);
    assert.ok(docx.contentType.includes('wordprocessingml'), 'docx mime');
    assert.ok(/attachment/.test(docx.disposition) && /\.docx/.test(docx.disposition), 'attachment .docx filename');
    assert.ok(decodeURIComponent(docx.disposition).includes('面談紀錄'), 'kind-prefixed filename');
    assert.equal(docx.buf.slice(0, 2).toString(), 'PK', 'valid OOXML (zip) magic');

    await api('DELETE', `/api/knowledge/${closed.json.savedDocId}`);
    await api('DELETE', `/api/dialogues/${d.id}`);
  });

  await step('cross-meeting memory: a finished meeting writes each participant a memory document', async () => {
    delete process.env.MEETING_MEMORY_DISABLE; // feature on for this step only
    try {
      const { json: alice } = await api('POST', '/api/employees', { name: 'Memory Alice', roleTitle: '產品經理' });
      const { json: bob } = await api('POST', '/api/employees', { name: 'Memory Bob', roleTitle: '工程師' });

      const { status, json: meeting } = await api('POST', '/api/meetings', {
        topic: '記憶功能驗證會議', participantIds: [alice.id, bob.id], rounds: 2,
      });
      assert.equal(status, 201);
      assert.equal(meeting.memories.length, 2, 'one distilled memory per participant');
      assert.ok(meeting.memories.every((m) => m.documentId), 'memories are real knowledge documents');

      const { json: aliceFull } = await api('GET', `/api/employees/${alice.id}`);
      const mem = aliceFull.knowledge.find((k) => k.source === 'memory');
      assert.ok(mem, 'memory doc lands in the participant knowledge base');
      assert.ok(mem.title.includes('記憶功能驗證會議'), 'titled after the meeting topic');
      assert.ok(mem.tags.includes('meeting'));
      assert.ok(mem.chunkCount > 0, 'memory is chunked → retrievable in future groundings');

      // The whole point: a topic-related query now surfaces the memory.
      const q = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('記憶功能 驗證')}&employeeIds=${alice.id}`);
      assert.ok(q.json.results.some((r) => r.documentId === mem.id), 'the next meeting WOULD ground on this memory');

      // Reopen + re-conclude REPLACES the per-participant memory (one active
      // memory per (employee, meeting) — never a stale duplicate).
      await api('POST', `/api/meetings/${meeting.id}/reopen`);
      const readSse = async (pathname, body) => {
        const res = await fetch(base + pathname, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        return (await res.text()).split('\n\n').filter(Boolean)
          .map((f) => f.split('\n').find((l) => l.startsWith('data: ')))
          .filter(Boolean).map((l) => JSON.parse(l.slice(6)));
      };
      await readSse(`/api/meetings/${meeting.id}/continue/stream`, { rounds: 1 });
      await readSse(`/api/meetings/${meeting.id}/conclude/stream`, {});
      const { json: aliceAfter } = await api('GET', `/api/employees/${alice.id}`);
      const memsAfter = aliceAfter.knowledge.filter(
        (k) => k.source === 'memory' && k.metadata?.meetingId === meeting.id,
      );
      assert.equal(memsAfter.length, 1, 'exactly one active memory per meeting after re-conclusion');
      assert.notEqual(memsAfter[0].id, mem.id, 'the memory was REPLACED (fresh distillation), not kept stale');

      await api('DELETE', `/api/employees/${alice.id}`);
      await api('DELETE', `/api/employees/${bob.id}`);
    } finally {
      process.env.MEETING_MEMORY_DISABLE = '1';
    }
  });

  await step('goal rerun: the team re-collaborates on the prior plan; result replaces it', async () => {
    const { json: goal } = await api('POST', '/api/goals', {
      title: '重跑驗證目標', description: '第一版', assigneeIds: [empId],
    });
    assert.ok(goal.output.length > 0, 'first run produced a plan');
    await api('PUT', `/api/goals/${goal.id}`, { status: 'done' }); // manager closed it

    const rerun = await api('POST', `/api/goals/${goal.id}/rerun`, { instruction: '把範疇縮小到行動端' });
    assert.equal(rerun.status, 200);
    assert.equal(rerun.json.status, 'in-progress', 'a re-run reopens the goal');
    assert.ok(Array.isArray(rerun.json.tasks) && rerun.json.tasks.length > 0, 'tasks regenerated');
    assert.ok(rerun.json.output.length > 0, 'a fresh plan replaced the old one');
    assert.equal(rerun.json.description, '第一版',
      'the STORED description stays original — prior-plan context is per-run only');

    const { json: fresh } = await api('GET', `/api/goals/${goal.id}`);
    assert.equal(fresh.status, 'in-progress', 'replacement persisted');

    // Phase 20 — task EXECUTION (交付). A real deliverable needs the live brain
    // (a fabricated offline "deliverable" would be dishonest), so the hermetic
    // run asserts the refusal is clear and actionable; a missing task is a 404.
    const refused = await api('POST', `/api/goals/${goal.id}/tasks/1/execute`);
    assert.equal(refused.status, 400, 'offline → execution refused, not faked');
    assert.ok(/即時大腦|金鑰|訂閱/.test(refused.json.error), 'error says exactly what to configure');
    const missing = await api('POST', `/api/goals/${goal.id}/tasks/99/execute`);
    assert.equal(missing.status, 404);

    await api('DELETE', `/api/goals/${goal.id}`);
  });

  await step('close the loop: a meeting\'s action items spin off into an executable goal', async () => {
    // A one-shot meeting is concluded with minutes; the engine gives each
    // participant an action item owned by their name.
    const { json: meeting } = await api('POST', '/api/meetings', {
      topic: '閉環驗證會議', participantIds: [empId], rounds: 1,
    });
    assert.ok(meeting.minutes.actionItems.length > 0, 'meeting produced action items');

    const spun = await api('POST', `/api/goals/from-meeting/${meeting.id}`);
    assert.equal(spun.status, 201);
    assert.ok(spun.json.title.includes('閉環驗證會議'), 'goal titled after the meeting');
    assert.ok(spun.json.tasks.length > 0, 'action items became tasks');
    assert.ok(spun.json.tasks.every((t) => t.status === 'pending'), 'tasks are 待執行, ready to execute');
    assert.ok(spun.json.tasks.every((t) => t.assigneeId === empId), 'each task assigned to its action-item owner');
    assert.ok(spun.json.tasks[0].subtask.length > 0, 'the action text becomes the subtask');
    assert.deepEqual(spun.json.assigneeIds, [empId], 'goal assignees derived from mappable owners');

    // The spun-off task is immediately executable through the SAME path (offline
    // → refused with the actionable error, proving the wiring is real).
    const exec = await api('POST', `/api/goals/${spun.json.id}/tasks/1/execute`);
    assert.equal(exec.status, 400);
    assert.ok(/即時大腦|金鑰|訂閱/.test(exec.json.error), 'the spun-off task feeds the real execution path');

    // Missing meeting → 404.
    const nope = await api('POST', '/api/goals/from-meeting/mtg_nope');
    assert.equal(nope.status, 404);

    await api('DELETE', `/api/goals/${spun.json.id}`);
    await api('DELETE', `/api/meetings/${meeting.id}`);
  });

  await step('web-search toggle: reported off and un-enableable without a provider key', async () => {
    const { json: settings } = await api('GET', '/api/settings');
    assert.equal(settings.webSearch.keyConfigured, false, 'hermetic run has no Tavily key');
    assert.equal(settings.webSearch.enabled, false);

    const { status } = await api('PUT', '/api/settings', { webSearchEnabled: true });
    assert.equal(status, 400, 'turning it on without a key is refused with a clear error');

    const { json: health } = await api('GET', '/api/health');
    assert.equal(health.tools.knowledgeSearch, true);
    assert.equal(health.tools.webSearch, false);
    assert.equal(health.tools.webSearchKey, false);
  });

  await step('chair config (⚙️ 設定): persisted, sanitized, and merge-patchable', async () => {
    const { json: before } = await api('GET', '/api/settings');
    assert.deepEqual(before.chair, { dynamicOrder: true, followUps: true, style: 'standard', model: '' },
      'defaults: dynamic ordering + follow-ups on, standard style, no model override');

    // Garbage in → sanitized out; valid fields persist.
    const { json: saved } = await api('PUT', '/api/settings', {
      chairConfig: { dynamicOrder: false, followUps: false, style: 'weird', model: 123 },
    });
    assert.deepEqual(saved.chair, { dynamicOrder: false, followUps: false, style: 'standard', model: '' });

    // Partial patch merges instead of resetting the rest.
    const { json: patched } = await api('PUT', '/api/settings', { chairConfig: { style: 'strict' } });
    assert.deepEqual(patched.chair, { dynamicOrder: false, followUps: false, style: 'strict', model: '' });

    // Restore defaults for the rest of the suite.
    const { json: restored } = await api('PUT', '/api/settings', {
      chairConfig: { dynamicOrder: true, followUps: true, style: 'standard', model: '' },
    });
    assert.equal(restored.chair.dynamicOrder, true);
  });

  await step('runtime tunables (⚙️ 設定): live values, clamped writes, null restores boot', async () => {
    const { json: s0 } = await api('GET', '/api/settings');
    const t0 = s0.tunables;
    assert.ok(t0.values && t0.defaults, 'values + boot defaults exposed');
    assert.equal(t0.values.turnTokens, t0.defaults.turnTokens, 'no overrides initially');
    assert.equal(t0.values.memoryDistill, false, 'boot default reflects this suite\'s env (distiller off)');

    // Write: valid values apply immediately; out-of-range ints are clamped.
    const { json: s1 } = await api('PUT', '/api/settings', {
      tunables: { turnTokens: 4096, maxToolCalls: 99, webSearchDepth: 'basic' },
    });
    assert.equal(s1.tunables.values.turnTokens, 4096);
    assert.equal(s1.tunables.values.maxToolCalls, 10, 'clamped to the max');
    assert.equal(s1.tunables.values.webSearchDepth, 'basic');

    // Nonsense is refused with a clear 400.
    const badEnum = await api('PUT', '/api/settings', { tunables: { webSearchDepth: 'ultra' } });
    assert.equal(badEnum.status, 400);
    const badKey = await api('PUT', '/api/settings', { tunables: { hackThePlanet: 1 } });
    assert.equal(badKey.status, 400);
    const badNum = await api('PUT', '/api/settings', { tunables: { turnTokens: 'abc' } });
    assert.equal(badNum.status, 400);

    // null clears each override back to the BOOT value (env keeps its meaning).
    const { json: s2 } = await api('PUT', '/api/settings', {
      tunables: { turnTokens: null, maxToolCalls: null, webSearchDepth: null },
    });
    assert.equal(s2.tunables.values.turnTokens, t0.defaults.turnTokens);
    assert.equal(s2.tunables.values.maxToolCalls, t0.defaults.maxToolCalls);
    assert.equal(s2.tunables.values.webSearchDepth, t0.defaults.webSearchDepth);
  });

  await step('in-app API keys: save → masked status, unlocks features; clear → reverts', async () => {
    // Hermetic run starts with nothing configured (no env keys, empty DB).
    const { json: before } = await api('GET', '/api/settings');
    assert.equal(before.apiKeys.gemini.configured, false);
    assert.equal(before.apiKeys.tavily.configured, false);

    // Testing an unknown provider is a 400; testing with no key stored is an
    // honest local failure (never a network call).
    const badProvider = await api('POST', '/api/settings/api-keys/test', { provider: 'nonsense' });
    assert.equal(badProvider.status, 400);
    const noKey = await api('POST', '/api/settings/api-keys/test', { provider: 'tavily' });
    assert.equal(noKey.json.ok, false);
    assert.ok(noKey.json.error.includes('未提供金鑰'));

    // Save both keys via the UI endpoint (deliberately fake values).
    const fakeTavily = 'test-tavily-key-000000001234';
    const fakeGemini = 'test-gemini-key-000000005678';
    const { json: saved } = await api('PUT', '/api/settings/api-keys', { tavily: fakeTavily, gemini: fakeGemini });
    // CRITICAL: a saved key must never round-trip to the client — only a tail.
    assert.ok(!JSON.stringify(saved).includes(fakeTavily), 'full Tavily key never leaves the server');
    assert.ok(!JSON.stringify(saved).includes(fakeGemini), 'full Gemini key never leaves the server');
    assert.deepEqual(saved.apiKeys.tavily, { configured: true, source: 'ui', tail: '…1234' });
    assert.deepEqual(saved.apiKeys.gemini, { configured: true, source: 'ui', tail: '…5678' });

    // The keys actually unlock features: web-search toggle turns on-able and
    // the google brain reports live.
    assert.equal(saved.webSearch.keyConfigured, true);
    assert.equal(saved.llm.live, true, 'google brain is live via the UI-saved key');
    const on = await api('PUT', '/api/settings', { webSearchEnabled: true });
    assert.equal(on.status, 200, 'toggle now accepts ON');
    assert.equal(on.json.webSearch.enabled, true);

    // Clear both keys ('' = back to env fallback, which is empty here) — the
    // whole surface degrades honestly, including the previously-ON toggle.
    const { json: cleared } = await api('PUT', '/api/settings/api-keys', { tavily: '', gemini: '' });
    assert.equal(cleared.apiKeys.tavily.configured, false);
    assert.equal(cleared.apiKeys.gemini.configured, false);
    assert.equal(cleared.webSearch.keyConfigured, false);
    assert.equal(cleared.webSearch.enabled, false, 'toggle reads OFF once the key is gone');
    assert.equal(cleared.llm.live, false);
  });

  await step('autonomous research: refused while research prerequisites are missing', async () => {
    const { status, json } = await api('POST', `/api/employees/${empId}/research`, { topic: '任意主題' });
    assert.equal(status, 400);
    assert.ok(/GEMINI|TAVILY|網路搜尋/.test(json.error), 'error names the missing prerequisite');
  });

  await step('autonomous research: manager approval ingests the report into the knowledge base', async () => {
    // Simulate a completed agent research run at the repo layer (the live agent
    // path needs real keys and is exercised by test:live), then walk the REAL
    // review flow over HTTP.
    const { insertReport } = await import('../src/storage/research.repo.js');
    const pending = insertReport({
      employeeId: empId,
      topic: '客服自動化趨勢',
      report: '## 摘要\n測試研究內容。\n\n## 資料來源\n- 測試來源 — https://example.com/a',
      sources: [{ title: '測試來源', url: 'https://example.com/a' }],
      queries: ['customer service automation trends'],
    });

    const { json: list } = await api('GET', `/api/employees/${empId}/research`);
    assert.ok(list.some((r) => r.id === pending.id && r.status === 'pending'), 'pending report is listed');

    const { status, json } = await api('POST', `/api/research/${pending.id}/approve`);
    assert.equal(status, 200);
    assert.equal(json.report.status, 'approved');
    assert.ok(json.document?.id, 'approval created a knowledge document');

    const { json: emp } = await api('GET', `/api/employees/${empId}`);
    const doc = emp.knowledge.find((k) => k.id === json.document.id);
    assert.ok(doc, 'document appears in the employee knowledge base');
    assert.equal(doc.source, 'research');
    assert.ok(doc.title.includes('客服自動化趨勢'));

    const again = await api('POST', `/api/research/${pending.id}/approve`);
    assert.equal(again.status, 400, 'double review is refused');

    // Rejection path: archived, no document.
    const rejected = insertReport({ employeeId: empId, topic: '應駁回的主題', report: 'x', sources: [], queries: ['q'] });
    const rej = await api('POST', `/api/research/${rejected.id}/reject`);
    assert.equal(rej.status, 200);
    assert.equal(rej.json.report.status, 'rejected');
    assert.equal(rej.json.report.documentId, null);

    // Keep the shared employee's knowledge base clean for the later delete check.
    await api('DELETE', `/api/knowledge/${json.document.id}`);
  });

  await step('knowledge viewer: document detail exposes full content + ordered chunks', async () => {
    const { status, json } = await api('GET', `/api/knowledge/${docId}`);
    assert.equal(status, 200);
    assert.ok(json.content.length > 0, 'full content returned');
    assert.ok(Array.isArray(json.chunks) && json.chunks.length === json.chunkCount,
      'chunks array matches the advertised count');
    assert.deepEqual(json.chunks.map((c) => c.chunkIndex), json.chunks.map((_, i) => i), 'chunks are ordered');
    assert.ok(json.chunks[0].content.length > 0, 'chunk text is the retrievable slice');
    const missing = await api('GET', '/api/knowledge/doc_nope');
    assert.equal(missing.status, 404);
  });

  await step('C4: a huge document is chunk-capped (event-loop guard) and delete removes FTS rows', async () => {
    // Build content that far exceeds the chunk cap (each ~500-char line ≈ one
    // chunk, ×2500 → >2000 chunks), then confirm it's bounded.
    const filler = '資料必須留在境內'.repeat(60); // ~480 chars
    const huge = Array.from({ length: 2500 }, (_, i) => `第 ${i} 條規則：${filler}。`).join('\n\n');
    const { status, json: big } = await api('POST', `/api/employees/${empId}/knowledge`, { title: '超大文件', content: huge });
    assert.ok(status === 200 || status === 201, `created (got ${status})`);
    assert.ok(big.chunkCount <= 2000, `chunk count is capped (got ${big.chunkCount})`);
    assert.equal(big.metadata.truncatedChunks, true, 'truncation is recorded, not hidden');
    assert.ok(big.metadata.totalChunks > big.metadata.indexedChunks, 'metadata reports full vs indexed');

    // Retrieval still works on the indexed portion.
    const found = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('境內')}&employeeIds=${empId}`);
    assert.ok(found.json.results.some((r) => r.documentId === big.id), 'capped doc is still retrievable');

    // Delete removes the doc AND its FTS rows (single-statement path).
    await api('DELETE', `/api/knowledge/${big.id}`);
    const after = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('境內')}&employeeIds=${empId}`);
    assert.ok(!after.json.results.some((r) => r.documentId === big.id), 'FTS rows gone after delete');
  });

  await step('delete knowledge document', async () => {
    const { status } = await api('DELETE', `/api/knowledge/${docId}`);
    assert.equal(status, 200);
    const { json } = await api('GET', `/api/employees/${empId}`);
    assert.equal(json.knowledge.length, 0);
  });

  await step('persistence: employees survive a fresh read', async () => {
    const { json } = await api('GET', '/api/employees');
    assert.ok(json.length >= 2);
  });

  await step('dashboard summarizes counts + live ratios', async () => {
    const { status, json } = await api('GET', '/api/dashboard');
    assert.equal(status, 200);
    assert.ok(json.counts.employees >= 2);
    assert.ok('liveTurnRatio' in json.runs);
    assert.ok('avgChunksPerDocument' in json.knowledge);
  });

  await step('meetings list supports search/filter/sort/pagination', async () => {
    const { status, json } = await api('GET', `/api/meetings?q=Regression&participantId=${empId}&sort=topic-asc&page=1&pageSize=1`);
    assert.equal(status, 200);
    assert.equal(json.items.length, 1);
    assert.equal(json.total, 1);
    assert.equal(json.items[0].id, meetingId);
    assert.equal(json.pageSize, 1);
    assert.equal(json.totalPages, 1);
  });

  await step('meetings list rows are LIGHTWEIGHT (C1): no transcript/grounding blobs, counts as numbers', async () => {
    const { json } = await api('GET', '/api/meetings?pageSize=1');
    const row = json.items[0];
    assert.ok(row, 'has a row');
    assert.equal(row.transcript, undefined, 'no transcript blob in the list row');
    assert.equal(row.minutes, undefined, 'no minutes blob');
    assert.equal(row.grounding, undefined, 'no grounding blob');
    assert.equal(row.report, undefined, 'no report body');
    assert.equal(typeof row.groundingCount, 'number', 'groundingCount is a number from SQL');
    assert.ok(Array.isArray(row.participants), 'participants (names) kept for the list');
    // Clicking still gets the full record via GET /:id.
    const { json: full } = await api('GET', `/api/meetings/${row.id}`);
    assert.ok(Array.isArray(full.transcript), 'detail fetch has the full transcript');
  });

  await step('goals list supports search/filter/sort/pagination', async () => {
    const { status, json } = await api('GET', `/api/goals?q=beta&assigneeId=${empId}&status=in-progress&sort=title-asc&page=1&pageSize=1`);
    assert.equal(status, 200);
    assert.equal(json.items.length, 1);
    assert.equal(json.total, 1);
    assert.equal(json.items[0].id, goalId);
    assert.equal(json.pageSize, 1);
    assert.equal(json.totalPages, 1);
  });

  await step('goals list rows are LIGHTWEIGHT (C1): no tasks/output blobs, taskCount as number', async () => {
    const { json } = await api('GET', '/api/goals?pageSize=1');
    const row = json.items[0];
    assert.ok(row, 'has a row');
    assert.equal(row.tasks, undefined, 'no tasks blob in the list row');
    assert.equal(row.output, undefined, 'no output body');
    assert.equal(row.grounding, undefined, 'no grounding blob');
    assert.equal(typeof row.taskCount, 'number', 'taskCount is a number from SQL');
    const { json: full } = await api('GET', `/api/goals/${row.id}`);
    assert.ok(Array.isArray(full.tasks), 'detail fetch has the full tasks');
  });

  console.log(`\n  All ${passed} smoke checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ FAILED after ${passed} checks:`, err.message, '\n', err.stack);
  process.exitCode = 1;
} finally {
  server.close();
}

// Hermetic suites must guarantee their own exit. The in-process fetch()
// clients (and SSE readers) hold keep-alive sockets to the server we just
// closed; on Linux those handles kept the event loop alive indefinitely and
// hung CI from day one. Exit on a short (non-unref'd) timer: the delay lets
// the close op finish first — exiting in the same tick trips a libuv
// teardown assertion on Windows.
setTimeout(() => process.exit(process.exitCode || 0), 500);
