// REAL OpenClaw runtime smoke test (opt-in, spends real subagent turns).
//
// Unlike smoke.mjs (which is hermetic and forces the simulated fallback), this
// test boots the app with the OpenClaw runtime ACTIVE and drives a genuine
// meeting + goal through the `openclaw` CLI → Gateway. It asserts the results
// are flagged as real OpenClaw-backed execution (engine 'openclaw-cli', not a
// fallback) and that the transcript/output actually came from live subagents.
//
// Requirements: the `openclaw` binary on PATH and a running OpenClaw Gateway
// with at least one agent. Each turn is a real model call, so this is slow
// (tens of seconds) and is NOT part of `npm test`. Run it explicitly:
//   npm run test:openclaw
//
// If the CLI/Gateway is unreachable it SKIPS (exit 0) rather than failing, so it
// is safe to wire into environments that may not have OpenClaw available.
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.RUNTIME_MODE = 'openclaw';
delete process.env.OPENCLAW_DISABLE;
// Keep it as cheap as possible: minimal thinking, small runs.
process.env.OPENCLAW_THINKING = process.env.OPENCLAW_THINKING || 'off';

const cli = await import('../src/runtime/openclaw/cli.js');
if (!(await cli.available())) {
  console.log('\n  ⚠ 找不到可用的 OpenClaw CLI／Gateway — 略過真實執行測試（exit 0）。\n');
  process.exit(0);
}

const { app } = await import('../src/index.js');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

let passed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  await fn();
  passed++;
  console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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

try {
  await step('health reports OpenClaw live', async () => {
    const { json } = await api('GET', '/api/health');
    assert.equal(json.openclaw.live, true, 'OpenClaw CLI/Gateway should be live');
    assert.equal(json.openclaw.engine, 'openclaw-cli');
    console.log(`      gateway=${json.openclaw.gateway} version=${json.openclaw.version}`);
  });

  let a, b;
  await step('create two employees', async () => {
    ({ json: a } = await api('POST', '/api/employees', {
      name: '陳工程師', roleTitle: '後端工程師', expertise: ['API', '資料庫', '可靠性'],
      personality: '有系統且重視風險', communicationStyle: '精確且結構化',
    }));
    ({ json: b } = await api('POST', '/api/employees', {
      name: '林設計師', roleTitle: '前端工程師', expertise: ['React', 'UI/UX', '無障礙設計'],
      personality: '注重細節', communicationStyle: '重視視覺與範例',
    }));
    assert.ok(a.id && b.id);
  });

  await step('run a REAL OpenClaw meeting (2 subagents × 2 rounds)', async () => {
    const { status, json } = await api('POST', '/api/meetings', {
      topic: '設計一個安全的登入流程', participantIds: [a.id, b.id], rounds: 2,
    });
    assert.equal(status, 201);
    assert.equal(json.runtime.mode, 'openclaw');
    assert.equal(json.runtime.engine, 'openclaw-cli', 'must be real OpenClaw-backed, not simulated');
    assert.equal(json.runtime.fallback, false, 'must not be a fallback');
    assert.ok(json.runtime.liveTurns >= 1, 'at least one live subagent turn');
    assert.equal(json.transcript.length, 4, '2 participants × 2 rounds');
    assert.ok(json.transcript.every((t) => t.text && t.text.length > 0), 'every turn has real text');
    assert.ok(json.transcript.some((t) => t.live), 'transcript contains live turns');
    assert.ok(json.report && json.report.length > 40, 'manager synthesized a report');
    console.log(`      model=${json.runtime.model} liveTurns=${json.runtime.liveTurns}/${json.runtime.totalTurns}`);
    console.log(`      sample: ${json.transcript[0].speaker}: ${json.transcript[0].text.slice(0, 60)}…`);
  });

  await step('assign a REAL OpenClaw goal (1 subagent)', async () => {
    const { status, json } = await api('POST', '/api/goals', {
      title: '在週五前把登入流程上線', description: '需通過安全審查並具備測試覆蓋。',
      assigneeIds: [a.id],
    });
    assert.equal(status, 201);
    assert.equal(json.runtime.engine, 'openclaw-cli');
    assert.equal(json.runtime.fallback, false);
    assert.equal(json.tasks.length, 1);
    assert.ok(json.tasks[0].approach.length > 10, 'assignee produced a real approach');
    assert.ok(json.output.length > 40, 'manager synthesized a collaboration output');
    console.log(`      approach: ${json.tasks[0].approach.slice(0, 60)}…`);
  });

  console.log(`\n  All ${passed} REAL OpenClaw smoke checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ FAILED after ${passed} checks:`, err.message, '\n', err.stack);
  process.exitCode = 1;
} finally {
  server.close();
}
