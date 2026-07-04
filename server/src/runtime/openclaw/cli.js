// Low-level OpenClaw CLI client.
//
// This is the single, narrow seam between our backend process and the *real*
// OpenClaw runtime. Every subagent turn goes through `runTurn()`, which shells
// out to `openclaw agent --session-id <id> --message <text> --json`. The CLI
// talks to the local OpenClaw Gateway, which owns the actual agent/model
// execution — so a "turn" here is a genuine OpenClaw agent turn, not a
// simulation. Each distinct session id is an isolated, persistent conversation,
// which is exactly what lets us model one virtual employee as one subagent that
// remembers its own context across meeting rounds.
//
// We use `execFile` (not a shell) so employee/persona text can never be
// interpreted as shell syntax, and so stdout is exactly the CLI's JSON.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../../config.js';

const pexec = promisify(execFile);

// Availability is probed lazily and cached briefly. `available()` refreshes it;
// `availableSync()` returns the last known value for the sync `label` getter.
const CACHE_TTL_MS = 30_000;
let probeCache = null; // { at, ok, version, error }

function nowMs() {
  return Date.now();
}

/**
 * Fast liveness probe: is the `openclaw` CLI present and responding? Cached for
 * CACHE_TTL_MS. Returns { ok, version, error }.
 * @param {{force?: boolean}} [opts]
 */
export async function probe({ force = false } = {}) {
  if (config.openclaw.disabled) {
    probeCache = { at: nowMs(), ok: false, version: null, error: 'OPENCLAW_DISABLE 已設定' };
    return probeCache;
  }
  if (!force && probeCache && nowMs() - probeCache.at < CACHE_TTL_MS) {
    return probeCache;
  }
  try {
    const { stdout } = await pexec(config.openclaw.cli, ['--version'], { timeout: 8_000 });
    probeCache = { at: nowMs(), ok: true, version: String(stdout).trim(), error: null };
  } catch (err) {
    probeCache = { at: nowMs(), ok: false, version: null, error: err.message };
  }
  return probeCache;
}

/** Async: is the OpenClaw CLI usable right now? */
export async function available() {
  return (await probe()).ok;
}

/** Sync: last known availability (null = never probed). For the label getter. */
export function availableSync() {
  if (config.openclaw.disabled) return false;
  return probeCache ? probeCache.ok : null;
}

/**
 * Fuller status snapshot for the health endpoint: CLI liveness + Gateway agents.
 * Never throws — degrades to whatever it could learn.
 */
export async function status() {
  const p = await probe({ force: true });
  const out = {
    cli: config.openclaw.cli,
    available: p.ok,
    version: p.version,
    error: p.error,
    agents: null,
  };
  if (!p.ok) return out;
  try {
    const { stdout } = await pexec(config.openclaw.cli, ['agents', 'list'], { timeout: 8_000 });
    // Parse the human "- <id> (default)" lines into a small list.
    out.agents = String(stdout)
      .split('\n')
      .map((l) => l.match(/^\s*-\s*([\w.-]+)/))
      .filter(Boolean)
      .map((m) => m[1]);
  } catch {
    // Gateway may be down even if the binary exists — leave agents null.
  }
  return out;
}

/**
 * Run a single real OpenClaw agent turn on a session and return its reply.
 *
 * @param {object}  opts
 * @param {string}  opts.sessionId   isolated session (one per employee/run)
 * @param {string}  opts.message     the turn's message body
 * @param {string}  [opts.agentId]   route to a specific agent (`--agent`)
 * @param {string}  [opts.thinking]  off|minimal|low|medium|high
 * @param {number}  [opts.timeoutSec]
 * @returns {Promise<{ ok:boolean, text:string, status:string,
 *   meta:{ sessionId, model, provider, durationMs, usage }, error:string|null }>}
 */
export async function runTurn({ sessionId, message, agentId, thinking, timeoutSec } = {}) {
  if (!sessionId || !message) {
    return { ok: false, text: '', status: 'error', meta: null, error: 'sessionId 與 message 為必填' };
  }
  const secs = Number(timeoutSec) || config.openclaw.timeoutSec;
  const args = ['agent', '--session-id', sessionId, '--message', message, '--json', '--timeout', String(secs)];
  const agent = agentId || config.openclaw.agentId;
  if (agent) args.push('--agent', agent);
  const think = thinking || config.openclaw.thinking;
  if (think && think !== 'off') args.push('--thinking', think);

  const started = nowMs();
  try {
    const { stdout } = await pexec(config.openclaw.cli, args, {
      // Node kills the child after the CLI timeout + a grace margin.
      timeout: (secs + 15) * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = parseTurn(stdout);
    if (!parsed.text) {
      return {
        ok: false, text: '', status: parsed.status || 'empty', meta: parsed.meta,
        error: parsed.error || 'OpenClaw 回覆為空',
      };
    }
    return { ok: true, text: parsed.text, status: parsed.status || 'ok', meta: parsed.meta, error: null };
  } catch (err) {
    return {
      ok: false, text: '', status: 'error',
      meta: { sessionId, durationMs: nowMs() - started },
      error: err.message,
    };
  }
}

// Extract the reply text + run metadata from the CLI's `--json` payload. Tolerant
// of leading/trailing non-JSON noise by scanning to the first balanced object.
function parseTurn(stdout) {
  const json = extractJson(stdout);
  if (!json) return { text: '', status: 'parse-error', meta: null, error: '無法解析 OpenClaw JSON 輸出' };
  const payloads = json.result?.payloads || [];
  const text = payloads.map((p) => p?.text).filter(Boolean).join('\n').trim();
  const am = json.result?.meta?.agentMeta || {};
  return {
    text,
    status: json.status || null,
    error: json.error || null,
    meta: {
      sessionId: am.sessionId || null,
      model: am.model || null,
      provider: am.provider || null,
      durationMs: json.result?.meta?.durationMs ?? null,
      usage: am.usage || null,
    },
  };
}

function extractJson(text) {
  const s = String(text);
  try {
    return JSON.parse(s);
  } catch {
    // Fall back to slicing the first {...} balanced region.
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }
}
