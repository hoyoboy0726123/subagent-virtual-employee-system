// REAL MarkItDown ingestion smoke test (opt-in; needs Python + markitdown).
//
// Unlike smoke.mjs (which forces the built-in JS fallback with
// MARKITDOWN_DISABLE=1), this test drives the PRIMARY path: it uploads a real
// binary Office document (a .docx generated in-process with the `docx` library
// already used for report export) and asserts it was converted to canonical
// Markdown by Microsoft MarkItDown — proving the Node ↔ Python bridge, DOCX
// parsing, section-aware chunking, and retrieval all work end-to-end.
//
// Requirement: a Python interpreter with the `markitdown` package reachable
// (an explicit MARKITDOWN_PYTHON, a project-local `.venv`, or a system python3).
// If MarkItDown isn't available it SKIPS (exit 0), so it's safe to wire into any
// environment. Run it explicitly:  npm run test:markitdown
import assert from 'node:assert/strict';
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
} from 'docx';

process.env.DB_FILE = ':memory:';
process.env.OPENCLAW_DISABLE = '1';
delete process.env.MARKITDOWN_DISABLE; // we WANT the real MarkItDown path here

const { probe } = await import('../src/ingest/markitdown.js');
const info = await probe();
if (!info.available) {
  console.log('\n  ⚠ 找不到含 markitdown 套件的 Python — 略過真實 MarkItDown 測試（exit 0）。\n');
  console.log('    安裝方式： pip install \'markitdown[all]\'（或於專案 .venv 內安裝）。\n');
  process.exit(0);
}
console.log(`\n  MarkItDown 可用（版本 ${info.version || '?'}，直譯器 ${info.python}）。\n`);

const { app } = await import('../src/index.js');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const api = async (method, pathname, body) => {
  const res = await fetch(base + pathname, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, json };
};
const upload = async (pathname, { filename, buffer, type }) => {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], type ? { type } : undefined), filename);
  const res = await fetch(base + pathname, { method: 'POST', body: fd });
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, json };
};

// Build a small real .docx in-memory (with heading structure) using `docx`.
async function makeDocx() {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Quarterly Plan', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'Objectives', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun('Raise customer retention to ninety percent.')] }),
        new Paragraph({ text: 'Risks', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun('Supply-chain delays could slip the delivery date.')] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

try {
  let empId;
  await step('create an employee', async () => {
    const { json } = await api('POST', '/api/employees', { name: 'Ingest Bot', roleTitle: 'Analyst' });
    empId = json.id;
  });

  let docId;
  await step('upload a real .docx → converted by MarkItDown to Markdown', async () => {
    const buffer = await makeDocx();
    const { status, json } = await upload(`/api/employees/${empId}/knowledge/upload`, {
      filename: 'quarterly-plan.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    });
    assert.equal(status, 201, 'docx upload succeeds');
    assert.equal(json.metadata.sourceType, 'docx');
    assert.equal(json.metadata.parser, 'markitdown', 'PRIMARY MarkItDown path ran (not the fallback)');
    assert.equal(json.metadata.parseStatus, 'parsed');
    assert.ok(/Objectives/.test(json.content), 'markdown carries the DOCX heading');
    assert.ok(json.metadata.rawText && json.metadata.rawText.length > 0, 'raw text fallback preserved');
    assert.ok(json.chunkCount >= 2, 'section-aware chunking produced multiple chunks');
    docId = json.id;
  });

  await step('the MarkItDown-parsed doc is retrievable', async () => {
    const { json } = await api('GET', `/api/knowledge/search?q=retention&employeeIds=${empId}`);
    assert.ok(json.results.length >= 1, 'converted content is searchable');
    assert.equal(json.results[0].documentId, docId);
  });

  await step('health reports MarkItDown available', async () => {
    const { json } = await api('GET', '/api/health');
    assert.equal(json.ingest.markitdown.available, true);
  });

  console.log(`\n  All ${passed} real-MarkItDown checks passed ✅\n`);
} catch (err) {
  console.error('\n  ✗ MarkItDown smoke test failed:\n', err);
  process.exitCode = 1;
} finally {
  server.close();
}
