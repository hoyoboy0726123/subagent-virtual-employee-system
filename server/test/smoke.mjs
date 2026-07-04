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

  console.log(`\n  All ${passed} smoke checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ FAILED after ${passed} checks:`, err.message, '\n', err.stack);
  process.exitCode = 1;
} finally {
  server.close();
}
