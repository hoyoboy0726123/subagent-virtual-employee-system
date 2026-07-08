// Hermetic checks for the shared subscription-CLI runner (Milestone E #6).
// No real `claude`/`codex` binary, no network, no real child process — the
// exec impl is injected. The regression under test: a hung CLI process tree
// (execFile's 'close' callback never fires because a grandchild keeps the
// stdout pipe open) must NOT leak the caller's semaphore slot forever; the
// self-timeout guard has to force-resolve null and kill the tree.
// Run: part of `npm test`, or standalone `node server/test/smoke.cliRunner.mjs`.
import assert from 'node:assert/strict';
import { runCli } from '../src/reasoning/providers/cliRunner.js';

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A fake child whose callback fires on stdin.end — mirrors the real
// prompt-on-stdin flow. `pid` lets killTree find something to (pretend to) kill.
function fakeExec(stdout) {
  const seen = { stdin: '', errorHandled: false };
  const impl = (cmd, args, opts, cb) => {
    seen.cmd = cmd; seen.args = args; seen.opts = opts;
    return {
      pid: 4242,
      stdin: {
        on: (ev) => { if (ev === 'error') seen.errorHandled = true; },
        end: (d) => { if (d) seen.stdin += d; cb(null, typeof stdout === 'function' ? stdout(seen) : stdout, ''); },
      },
    };
  };
  return { impl, seen };
}

// A fake child that NEVER calls its callback — models a hung process tree.
// pid is a huge, guaranteed-nonexistent value so killTree's real signal is a
// harmless no-op on every platform: POSIX process.kill(-pid) → ESRCH (caught,
// falls through to child.kill spy), win32 taskkill against a dead pid → nothing.
function hangingExec() {
  const seen = { killed: false, stdin: '' };
  const impl = () => ({
    pid: 0x3fffffff, // ~1.07e9 — no such process/group anywhere
    kill: () => { seen.killed = true; },
    stdin: { on: () => {}, end: (d) => { if (d) seen.stdin += d; } },
  });
  return { impl, seen };
}

try {
  await step('happy path: feeds prompt on stdin, attaches error handler, returns stdout', async () => {
    const { impl, seen } = fakeExec((s) => `echo:${s.stdin}`);
    const out = await runCli('fake', ['--flag'], { timeoutMs: 1000, execFileImpl: impl }, '請發言');
    assert.equal(out, 'echo:請發言');
    assert.equal(seen.stdin, '請發言', 'prompt rides stdin');
    assert.ok(seen.errorHandled, "an stdin 'error' handler is mandatory (EPIPE must not crash the server)");
    assert.equal(seen.opts.timeout, 1000, 'native execFile timeout is set');
  });

  await step('error with no output → clean null (degrade to deterministic engine)', async () => {
    const impl = (cmd, args, opts, cb) => ({
      pid: 1, stdin: { on: () => {}, end: () => cb(new Error('boom'), '', '') },
    });
    assert.equal(await runCli('fake', [], { timeoutMs: 1000, execFileImpl: impl }, 'x'), null);
  });

  await step('error WITH partial output → keep the output (best-effort)', async () => {
    const impl = (cmd, args, opts, cb) => ({
      pid: 1, stdin: { on: () => {}, end: () => cb(new Error('timeout'), '半句', '') },
    });
    assert.equal(await runCli('fake', [], { timeoutMs: 1000, execFileImpl: impl }, 'x'), '半句');
  });

  await step('HUNG process tree self-recovers: guard force-resolves null (no semaphore leak)', async () => {
    const { impl } = hangingExec();
    // In production the real child-process handle keeps the event loop alive so
    // the (intentionally unref'd) guard timer can fire; the fake child is inert,
    // so we stand in a ref'd keep-alive to model that live handle.
    const keepAlive = setInterval(() => {}, 1000);
    const t0 = Date.now();
    // timeoutMs + graceMs = 80ms total budget — the child never calls back, so
    // only the guard can resolve this. If the fix regressed, this hangs forever.
    const out = await runCli('fake', [], { timeoutMs: 40, graceMs: 40, execFileImpl: impl }, 'x');
    const elapsed = Date.now() - t0;
    clearInterval(keepAlive);
    assert.equal(out, null, 'a hung child must resolve null, not hang the caller');
    assert.ok(elapsed >= 70 && elapsed < 2000, `guard fired in a sane window (was ${elapsed}ms)`);
  });

  await step('double-resolve is impossible: late callback after the guard is ignored', async () => {
    // Child calls back AFTER the guard already fired — done() must be idempotent.
    let late;
    const impl = (cmd, args, opts, cb) => ({ pid: 1, stdin: { on: () => {}, end: () => { late = cb; } } });
    const keepAlive = setInterval(() => {}, 1000);
    const out = await runCli('fake', [], { timeoutMs: 20, graceMs: 20, execFileImpl: impl }, 'x');
    clearInterval(keepAlive);
    assert.equal(out, null, 'guard resolved first');
    assert.doesNotThrow(() => late?.(null, '太遲了', ''), 'a late callback is a harmless no-op');
  });

  console.log(`\n  All ${passed} CLI-runner checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ CLI-runner check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
