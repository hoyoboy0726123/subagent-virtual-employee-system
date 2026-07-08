// Codex subscription provider (Phase 18) — drives the OFFICIAL `codex` CLI in
// non-interactive mode (`codex exec --json`) so agent turns run on the user's
// ChatGPT Plus/Pro subscription (the CLI owns the ChatGPT login; we never
// touch auth.json). Single-user, local machine only — see README for the
// terms-of-service notes.
//
// `codex exec` has no separate system-prompt flag, so the persona is folded
// into the prompt body — the same shim this codebase already used for legacy
// Gemma. Output is a JSONL event stream; the final answer is the
// `item.completed` event whose item type is `agent_message`.
import { execFile } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { resolveCli } from './resolveCli.js';
import { runCli } from './cliRunner.js';

function createSemaphore(max) {
  let active = 0;
  const queue = [];
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) { active++; next(); }
  };
  const acquire = () => new Promise((resolve) => {
    if (active < max) { active++; resolve(); }
    else queue.push(resolve);
  });
  return { acquire, release };
}

/**
 * @param {object} [opts]
 * @param {Function} [opts.execFileImpl] injectable child-process exec (hermetic tests)
 * @param {boolean}  [opts._available]   injectable probe result (hermetic tests)
 */
export function createCodexCliProvider({ execFileImpl = execFile, _available } = {}) {
  const cfg = () => config.llm.codexCli;
  const sem = createSemaphore(Math.max(cfg().maxConcurrent, 1));
  let probed = _available;
  let probedVersion = null;
  let scratchDir = null;
  let resolvedCmd = cfg().cli;
  let probedAt = 0;
  const NEG_TTL_MS = 60_000; // re-probe a negative result so a fresh install/login is picked up

  function availableSync() {
    if (_available !== undefined) return _available; // injected (tests) — fixed
    if (probed === true) return true;
    if (probed === false && (Date.now() - probedAt) < NEG_TTL_MS) return false;
    const found = resolveCli(cfg().cli);
    if (found) {
      resolvedCmd = found.cmd;
      probedVersion = found.version;
      probed = true;
    } else {
      probed = false;
      probedAt = Date.now();
    }
    return probed;
  }

  // codex wants a working directory; give it an empty scratch dir so agent
  // turns can never see (let alone touch) the real project.
  function scratch() {
    if (!scratchDir) {
      scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veemp-codex-'));
    }
    return scratchDir;
  }

  async function generate({ system, user, maxTokens, model } = {}) {
    if (!availableSync()) return null;
    const body = typeof user === 'string' ? user : String(user ?? '');
    if (!body.trim()) return null;
    // Fold the persona into the prompt (no system flag on `codex exec`).
    const prompt = system ? `${system}\n\n${body}` : body;

    const args = [
      'exec',
      '--json',
      '-m', model || cfg().model,
      '--sandbox', 'read-only',       // text generation only — no file/command agency
      '--skip-git-repo-check',
      '--cd', scratch(),
      '-',                            // prompt on stdin
    ];

    await sem.acquire();
    try {
      // runCli feeds `prompt` on stdin and guards against a hung process tree
      // that would otherwise leak this semaphore slot forever (see cliRunner.js).
      const stdout = await runCli(
        resolvedCmd,
        args,
        { timeoutMs: cfg().timeoutSec * 1000, execFileImpl },
        prompt,
      );
      if (!stdout) return null;
      const text = parseCodexJsonl(stdout);
      return text ? { text, functionCalls: [], raw: { stdout } } : null;
    } catch (err) {
      console.warn(`[codex-cli] turn failed, falling back to deterministic engine: ${err.message}`);
      return null;
    } finally {
      sem.release();
    }
  }

  return {
    name: 'codex-cli',
    label: () => `Codex 訂閱（codex CLI · ${cfg().model}）`,
    modelId: () => cfg().model,
    availableSync,
    version: () => probedVersion,
    generate,
  };
}

/** Pull the final agent message out of a `codex exec --json` JSONL stream. */
export function parseCodexJsonl(stdout) {
  let last = '';
  for (const line of String(stdout).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const evt = JSON.parse(trimmed);
      if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && evt.item.text) {
        last = String(evt.item.text).trim();
      }
    } catch { /* skip malformed lines */ }
  }
  return last;
}
