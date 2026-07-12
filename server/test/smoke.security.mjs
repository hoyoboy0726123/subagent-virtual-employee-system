// Phase 2-1 public-deploy hardening checks — hermetic (in-memory DB, no
// network listener beyond an ephemeral local port, no keys).
// Run: part of `npm test`, or standalone `node server/test/smoke.security.mjs`.
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

const { config } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  await step('security headers are present on every response', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('referrer-policy'));
  });

  await step('no CORS headers by default (same-origin app)', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  await step('CORS allow-list reflects only configured origins', async () => {
    config.corsOrigins.push('https://ok.example');
    try {
      const ok = await fetch(`${base}/api/health`, { headers: { origin: 'https://ok.example' } });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ok.example');
      const bad = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
      assert.equal(bad.headers.get('access-control-allow-origin'), null);
    } finally { config.corsOrigins.length = 0; }
  });

  await step('AUTH_TOKEN off → /api open (default local single-user)', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
  });

  await step('AUTH_TOKEN on → 401 without, 200 with (header or cookie)', async () => {
    config.authToken = 's3cret';
    try {
      const noTok = await fetch(`${base}/api/health`);
      assert.equal(noTok.status, 401);
      const bearer = await fetch(`${base}/api/health`, { headers: { authorization: 'Bearer s3cret' } });
      assert.equal(bearer.status, 200);
      const header = await fetch(`${base}/api/health`, { headers: { 'x-auth-token': 's3cret' } });
      assert.equal(header.status, 200);
      const cookie = await fetch(`${base}/api/health`, { headers: { cookie: 'veemp_token=s3cret' } });
      assert.equal(cookie.status, 200);
      const wrong = await fetch(`${base}/api/health`, { headers: { 'x-auth-token': 'nope' } });
      assert.equal(wrong.status, 401);
    } finally { config.authToken = ''; }
  });

  await step('rate limiter returns 429 past the window budget', async () => {
    const prev = { ...config.rateLimit };
    Object.assign(config.rateLimit, { max: 3, windowSec: 60 });
    try {
      // NOTE: earlier steps in this run already consumed budget for this IP on
      // a different limiter instance? No — limiter state lives per-app. Budget
      // here counts THIS test's requests plus the ones above (same app). So
      // simply hammer until we see a 429 within max+previous+1 attempts.
      let got429 = false;
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${base}/api/health`);
        if (res.status === 429) { got429 = true; break; }
      }
      assert.ok(got429, 'expected a 429 once past the budget');
    } finally { Object.assign(config.rateLimit, prev); }
  });

  await step('API keys are encrypted at rest (enc:v1: in the DB, plaintext out)', async () => {
    const { saveKeys, keyStatus, effectiveGeminiKey, GEMINI_KEY_SETTING } = await import('../src/reasoning/apiKeys.js');
    const { getSetting, setSetting } = await import('../src/storage/settings.repo.js');
    saveKeys({ gemini: 'test-key-123456' });
    const raw = getSetting(GEMINI_KEY_SETTING);
    assert.ok(raw.startsWith('enc:v1:'), 'stored value must be ciphertext');
    assert.ok(!raw.includes('test-key-123456'), 'plaintext must not appear in the DB');
    assert.equal(effectiveGeminiKey(), 'test-key-123456', 'decrypts back to the key');
    assert.equal(keyStatus().gemini.tail, '…3456', 'status still masks correctly');
    // legacy plaintext migrates to ciphertext on first read
    setSetting(GEMINI_KEY_SETTING, 'legacy-plain-9999');
    assert.equal(effectiveGeminiKey(), 'legacy-plain-9999');
    assert.ok(getSetting(GEMINI_KEY_SETTING).startsWith('enc:v1:'), 'legacy value upgraded in place');
    saveKeys({ gemini: '' }); // clean up
  });

  console.log(`\n  security smoke: all ${passed} checks passed ✅`);
} finally {
  server.close();
}
