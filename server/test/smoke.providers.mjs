// Phase 18 subscription-provider unit checks — hermetic: the child process is
// injected, no real `claude`/`codex` binary and no network is ever touched.
// Run: part of `npm test`, or standalone `node server/test/smoke.providers.mjs`.
import assert from 'node:assert/strict';

// Select a CLI provider BEFORE importing config-backed modules, and point it at
// a binary that cannot exist so probes fail fast and deterministically.
process.env.LLM_PROVIDER = 'claude-cli';
process.env.CLAUDE_CLI = 'veemp-no-such-binary';
process.env.ANTHROPIC_API_KEY = 'sk-test-should-be-stripped';
process.env.DB_FILE = ':memory:';

const { createClaudeCliProvider, parseClaudeJson } = await import('../src/reasoning/providers/claudeCli.js');
const { createCodexCliProvider, parseCodexJsonl } = await import('../src/reasoning/providers/codexCli.js');
const { llmEnabled, activeModelInfo, nativeToolsSupported, generate } = await import('../src/reasoning/llm.js');

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Fake child-process exec: captures the call, feeds back canned stdout when
// the provider closes stdin (mirroring the real prompt-on-stdin flow).
function fakeExec(stdout) {
  const seen = { stdin: '' };
  const impl = (cmd, args, opts, cb) => {
    seen.cmd = cmd; seen.args = args; seen.opts = opts;
    return {
      stdin: {
        on: () => {}, // real child.stdin has an 'error' listener hook
        write: (d) => { seen.stdin += d; },
        end: (d) => { if (d) seen.stdin += d; cb(null, typeof stdout === 'function' ? stdout(seen) : stdout, ''); },
      },
    };
  };
  return { impl, seen };
}

try {
  await step('parseClaudeJson: plain, noisy, and garbage stdout', () => {
    assert.equal(parseClaudeJson('{"result":"hi"}').result, 'hi');
    assert.equal(parseClaudeJson('some warning\n{"result":"ok","usage":{}}\n').result, 'ok');
    assert.equal(parseClaudeJson('not json at all'), null);
  });

  await step('parseCodexJsonl: picks the final agent_message from the event stream', () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"第一版"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"最終發言"}}',
      '{"type":"turn.completed","usage":{}}',
    ].join('\n');
    assert.equal(parseCodexJsonl(jsonl), '最終發言');
    assert.equal(parseCodexJsonl('junk\nnot json'), '');
  });

  await step('claude-cli provider: headless args, stdin prompt, stripped API key', async () => {
    const { impl, seen } = fakeExec(JSON.stringify({ result: '訂閱大腦的回覆', total_cost_usd: 0 }));
    const p = createClaudeCliProvider({ execFileImpl: impl, _available: true });
    const res = await p.generate({ system: '你是產品經理', user: '請發言', maxTokens: 700 });

    assert.equal(res.text, '訂閱大腦的回覆');
    assert.deepEqual(res.functionCalls, [], 'CLI providers have no native tools');
    assert.ok(seen.args.includes('-p') && seen.args.includes('--output-format'), 'headless json mode');
    assert.equal(seen.args[seen.args.indexOf('--model') + 1], 'sonnet', 'default subscription model');
    assert.equal(seen.args[seen.args.indexOf('--append-system-prompt') + 1], '你是產品經理');
    assert.ok(seen.args.includes('--disallowedTools'), 'Claude Code built-in tools are disabled');
    assert.equal(seen.stdin, '請發言', 'user prompt rides stdin');
    assert.equal(seen.opts.env.ANTHROPIC_API_KEY, undefined,
      'metered API key is stripped so subscription auth can never be bypassed');
    assert.equal(seen.opts.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '700');
  });

  await step('claude-cli provider: error results and garbage fall back to null', async () => {
    const err = createClaudeCliProvider({
      execFileImpl: fakeExec(JSON.stringify({ is_error: true, result: 'x' })).impl,
      _available: true,
    });
    assert.equal(await err.generate({ user: 'x' }), null);
    const garbage = createClaudeCliProvider({ execFileImpl: fakeExec('oops').impl, _available: true });
    assert.equal(await garbage.generate({ user: 'x' }), null);
    const offline = createClaudeCliProvider({ execFileImpl: fakeExec('{}').impl, _available: false });
    assert.equal(await offline.generate({ user: 'x' }), null, 'probe failure → clean null');
  });

  await step('codex-cli provider: exec args, folded system prompt, JSONL parse', async () => {
    const { impl, seen } = fakeExec([
      '{"type":"thread.started"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"codex 的發言"}}',
    ].join('\n'));
    const p = createCodexCliProvider({ execFileImpl: impl, _available: true });
    const res = await p.generate({ system: '你是工程師', user: '請發言' });

    assert.equal(res.text, 'codex 的發言');
    assert.equal(seen.args[0], 'exec');
    assert.ok(seen.args.includes('--json'));
    // No pinned model by default: ChatGPT-subscription auth 400s on ids it
    // doesn't offer, so we let the CLI use the account's default model.
    assert.ok(!seen.args.includes('-m'), 'no -m unless a model is explicitly configured');
    assert.equal(seen.args[seen.args.indexOf('--sandbox') + 1], 'read-only', 'no file/command agency');
    assert.equal(seen.args[seen.args.length - 1], '-', 'prompt rides stdin');
    assert.ok(seen.stdin.startsWith('你是工程師\n\n請發言'), 'system prompt folded into the body');

    // An explicit per-call model override IS pinned.
    const { impl: impl2, seen: seen2 } = fakeExec('{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}');
    const p2 = createCodexCliProvider({ execFileImpl: impl2, _available: true });
    await p2.generate({ user: 'x', model: 'my-model' });
    assert.equal(seen2.args[seen2.args.indexOf('-m') + 1], 'my-model', 'explicit model rides -m');
  });

  await step('llm.js integration: provider selection, gating, and tool-protocol routing', async () => {
    assert.equal(activeModelInfo().provider, 'claude-cli');
    assert.equal(activeModelInfo().model, 'sonnet');
    assert.equal(llmEnabled(), false, 'probe of a nonexistent binary → live brain unavailable');
    assert.equal(await generate({ user: 'hi' }), null, 'generate degrades cleanly to the engine fallback');
    assert.equal(nativeToolsSupported(), false, 'CLI providers always use the legacy prompt tool protocol');
  });

  console.log(`\n  All ${passed} provider checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ provider check #${passed + 1} failed`);
  console.error(err);
  process.exit(1);
}
