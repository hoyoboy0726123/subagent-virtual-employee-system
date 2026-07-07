// End-to-end smoke test. Boots the real Express app on an ephemeral port and
// exercises every core flow against live HTTP — now including SQLite-backed
// persistence, knowledge chunking + FTS retrieval, employee-scoped search, the
// runtime adapter switch, and knowledge-grounded meetings/goals.
// No external services needed. Run: `npm test`.
import assert from 'node:assert/strict';

// Use an isolated in-memory database BEFORE importing the app so the smoke test
// never touches seeded/real data.
process.env.DB_FILE = ':memory:';
// Keep this test hermetic and fast: force the OpenClaw runtime into its
// simulated fallback so we never spend real subagent turns here. The REAL
// OpenClaw path is exercised by the opt-in test/smoke.openclaw.mjs.
process.env.OPENCLAW_DISABLE = '1';
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
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, json };
};

// Multipart upload of an in-memory buffer — used to exercise knowledge-file
// ingestion. Content-Type is left to the browser/undici (multipart boundary).
const upload = async (pathname, { filename, content, type }) => {
  const fd = new FormData();
  fd.append('file', new Blob([content], type ? { type } : undefined), filename);
  const res = await fetch(base + pathname, { method: 'POST', body: fd });
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
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

  await step('health reports OpenClaw runtime liveness (disabled here)', async () => {
    const { json } = await api('GET', '/api/health');
    assert.ok(json.openclaw, 'health exposes openclaw block');
    assert.equal(json.openclaw.live, false, 'OPENCLAW_DISABLE → not live in this test');
    assert.equal(json.openclaw.disabled, true);
  });

  await step('switch runtime to openclaw (flagged offline fallback)', async () => {
    const { status, json } = await api('PUT', '/api/settings', { runtimeMode: 'openclaw' });
    assert.equal(status, 200);
    assert.equal(json.runtimeMode, 'openclaw');

    const { json: mtg } = await api('POST', '/api/meetings', {
      topic: 'Runtime switch check', participantIds: [empId], rounds: 1,
    });
    assert.equal(mtg.runtime.mode, 'openclaw');
    assert.equal(mtg.runtime.fallback, true, 'openclaw disabled → falls back but is labeled');
    assert.equal(mtg.runtime.engine, 'deterministic', 'fallback is honestly labeled as the offline engine');
    assert.equal(mtg.runtime.live, false);
    // Restore default so ordering never matters.
    await api('PUT', '/api/settings', { runtimeMode: 'standalone' });
  });

  await step('legacy "simulated" mode is normalized to standalone', async () => {
    const { status, json } = await api('PUT', '/api/settings', { runtimeMode: 'simulated' });
    assert.equal(status, 200);
    assert.equal(json.runtimeMode, 'standalone', 'legacy alias maps forward');
    await api('PUT', '/api/settings', { runtimeMode: 'standalone' });
  });

  await step('reject unknown runtime mode', async () => {
    const { status } = await api('PUT', '/api/settings', { runtimeMode: 'nonsense' });
    assert.equal(status, 400);
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

  await step('SSE streaming: a meeting streams round/turn events live, then done', async () => {
    const res = await fetch(`${base}/api/meetings/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '串流驗證會議', participantIds: [empId], rounds: 2 }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/event-stream'));

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

    await api('DELETE', `/api/meetings/${m.id}`);
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

      await api('DELETE', `/api/employees/${alice.id}`);
      await api('DELETE', `/api/employees/${bob.id}`);
    } finally {
      process.env.MEETING_MEMORY_DISABLE = '1';
    }
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

  await step('goals list supports search/filter/sort/pagination', async () => {
    const { status, json } = await api('GET', `/api/goals?q=beta&assigneeId=${empId}&status=in-progress&sort=title-asc&page=1&pageSize=1`);
    assert.equal(status, 200);
    assert.equal(json.items.length, 1);
    assert.equal(json.total, 1);
    assert.equal(json.items[0].id, goalId);
    assert.equal(json.pageSize, 1);
    assert.equal(json.totalPages, 1);
  });

  console.log(`\n  All ${passed} smoke checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ FAILED after ${passed} checks:`, err.message, '\n', err.stack);
  process.exitCode = 1;
} finally {
  server.close();
}
