// End-to-end smoke test. Boots the real Express app on an ephemeral port and
// exercises every core flow against live HTTP. No external services needed.
// Run: `npm test`.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Point the store at a throwaway file BEFORE importing the app so the smoke
// test never mutates seeded/real data.
process.env.DB_FILE = path.join(os.tmpdir(), `ves-smoke-${process.pid}.json`);
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

try {
  await step('health check responds', async () => {
    const { status, json } = await api('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
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

  await step('ideate a role from a description', async () => {
    const { status, json } = await api('POST', '/api/employees/ideate', {
      description: 'someone to run our marketing campaigns and content',
    });
    assert.equal(status, 200);
    assert.equal(json.roleTitle, 'Marketing Lead');
    assert.ok(json.profile.length > 20);
  });

  let empId2;
  await step('create a second employee', async () => {
    const { json } = await api('POST', '/api/employees', {
      name: 'Second Persona', roleTitle: 'Designer', expertise: ['ux', 'figma'],
    });
    empId2 = json.id;
  });

  let knId;
  await step('add a knowledge note', async () => {
    const { status, json } = await api('POST', `/api/employees/${empId}/knowledge`, {
      title: 'Test plan', content: 'Always test the happy path and one edge case.',
    });
    assert.equal(status, 201);
    assert.equal(json.employeeId, empId);
    knId = json.id;
  });

  await step('knowledge shows on employee detail', async () => {
    const { json } = await api('GET', `/api/employees/${empId}`);
    assert.equal(json.knowledge.length, 1);
    assert.equal(json.knowledge[0].id, knId);
  });

  await step('run a meeting and get transcript/minutes/report', async () => {
    const { status, json } = await api('POST', '/api/meetings', {
      topic: 'Release readiness',
      participantIds: [empId, empId2],
      rounds: 3,
    });
    assert.equal(status, 201);
    assert.equal(json.transcript.length, 6, '2 participants x 3 rounds');
    assert.ok(json.minutes.actionItems.length >= 2);
    assert.ok(json.report.includes('Release readiness'));
  });

  await step('reject meeting without participants', async () => {
    const { status } = await api('POST', '/api/meetings', { topic: 'Empty' });
    assert.equal(status, 400);
  });

  await step('assign a goal and get collaboration output', async () => {
    const { status, json } = await api('POST', '/api/goals', {
      title: 'Ship the beta',
      description: 'Get the beta into 10 teams by Friday.',
      assigneeIds: [empId, empId2],
    });
    assert.equal(status, 201);
    assert.equal(json.tasks.length, 2);
    assert.equal(json.status, 'in-progress');
    assert.ok(json.output.includes('Ship the beta'));
  });

  await step('persistence: employees survive a fresh read', async () => {
    const { json } = await api('GET', '/api/employees');
    assert.ok(json.length >= 2);
  });

  console.log(`\n  All ${passed} smoke checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ FAILED after ${passed} checks:`, err.message, '\n');
  process.exitCode = 1;
} finally {
  server.close();
}
