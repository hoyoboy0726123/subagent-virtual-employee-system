// Claude subscription provider (Phase 18) — drives the OFFICIAL `claude` CLI
// in headless mode (`claude -p --output-format json`) so agent turns run on
// the user's Claude Pro/Max subscription instead of a paid API key.
//
// Compliance notes (researched 2026-07):
//   • `claude -p` under a subscription login is the usage the official help
//     center describes ("draws from your subscription's usage limits").
//   • We NEVER read or replay OAuth tokens ourselves — the CLI owns auth.
//   • ANTHROPIC_API_KEY is stripped from the child env so a stray key can
//     never silently re-route subscription traffic to metered API billing
//     (a real, reported failure mode); we also watch `total_cost_usd` and
//     warn loudly if it ever comes back non-zero.
//   • Single-user, local machine only. Offering this to third parties on your
//     credentials violates Anthropic's terms — see README.
//
// The provider returns the same normalized shape as the google path
// ({ text, functionCalls: [], raw } or null), so every caller — and the
// deterministic-engine fallback contract — is untouched. No native function
// calling here: generateAgentic automatically uses the legacy prompt tool
// protocol for CLI providers.
import { execFile } from 'node:child_process';
import { config } from '../../config.js';
import { resolveCli } from './resolveCli.js';

// Tiny FIFO semaphore: subscription rate windows are shared, so we cap
// concurrent CLI turns instead of letting a 5-person meeting stampede them.
let costNoticeShown = false; // module-level: show the usage-estimate note once

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
export function createClaudeCliProvider({ execFileImpl = execFile, _available } = {}) {
  const cfg = () => config.llm.claudeCli;
  const sem = createSemaphore(Math.max(cfg().maxConcurrent, 1));
  let probed = _available;
  let probedVersion = null;
  let resolvedCmd = cfg().cli;
  let probedAt = 0;
  const NEG_TTL_MS = 60_000; // re-probe a negative result so a fresh install/login is picked up without restart

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

  function childEnv() {
    // Strip every metered-billing credential so the CLI can only use the
    // subscription login; surface the optional long-lived headless token when
    // configured. (Without this, a stray key silently re-routes subscription
    // traffic to per-token API billing — our live test caught exactly that.)
    // Bedrock/Vertex are the same hazard by another route (enterprise dev
    // machines often have these set), so they are cleared too.
    const {
      ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL,
      CLAUDE_CODE_USE_BEDROCK,
      CLAUDE_CODE_USE_VERTEX,
      ...env
    } = process.env;
    if (cfg().oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = cfg().oauthToken;
    return env;
  }

  async function generate({ system, user, maxTokens, model } = {}) {
    if (!availableSync()) return null;
    const prompt = typeof user === 'string' ? user : String(user ?? '');
    if (!prompt.trim()) return null;

    const args = [
      '-p',
      '--output-format', 'json',
      '--model', model || cfg().model,
      // Agent turns must be pure text generation: the app's own toolbox
      // (knowledge search / Tavily / remember) is the only tool surface, so
      // Claude Code's built-ins are disabled to avoid double agency.
      '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,NotebookEdit,Agent',
      // Ignore the host's MCP servers and project/user CLAUDE.md so a virtual
      // employee turn can't reach external tools or be steered by unrelated
      // repo instructions — it is just an isolated persona completion.
      '--strict-mcp-config',
    ];
    if (system) args.push('--append-system-prompt', system);

    const env = childEnv();
    if (maxTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxTokens);

    await sem.acquire();
    try {
      const stdout = await new Promise((resolve) => {
        const child = execFileImpl(
          resolvedCmd,
          args,
          {
            env,
            timeout: cfg().timeoutSec * 1000,
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true,
          },
          (err, out) => resolve(err && !out ? null : String(out || '')),
        );
        // The user prompt rides stdin — immune to argv quoting/length limits.
        // An 'error' handler is MANDATORY: if the CLI exits before draining a
        // large prompt (>~64KB pipe buffer), the EPIPE/EOF surfaces as an
        // async stream error that bypasses try/catch and would crash the whole
        // server (a failed agent turn must degrade, not take the process down).
        child?.stdin?.on('error', () => {});
        child?.stdin?.end(prompt);
      });
      if (!stdout) return null;

      const parsed = parseClaudeJson(stdout);
      if (!parsed || parsed.is_error) return null;
      // total_cost_usd is the CLI's list-price ESTIMATE of usage; on a Pro/Max
      // subscription login it is non-zero yet draws from the subscription (no
      // extra charge). We've stripped every metered-billing credential, so this
      // is informational only — note it ONCE per process, not per turn.
      if (Number(parsed.total_cost_usd) > 0 && !costNoticeShown) {
        costNoticeShown = true;
        console.info(
          `[claude-cli] 提示：CLI 回報用量估算約 $${parsed.total_cost_usd}/次（訂閱牌價換算）。`
          + '若你是以 Pro/Max 訂閱登入，這計入訂閱額度、不會額外計費。',
        );
      }
      const text = typeof parsed.result === 'string' ? parsed.result.trim() : '';
      return text ? { text, functionCalls: [], raw: parsed } : null;
    } catch (err) {
      console.warn(`[claude-cli] turn failed, falling back to deterministic engine: ${err.message}`);
      return null;
    } finally {
      sem.release();
    }
  }

  return {
    name: 'claude-cli',
    label: () => `Claude 訂閱（claude CLI · ${cfg().model}）`,
    modelId: () => cfg().model,
    availableSync,
    version: () => probedVersion,
    generate,
  };
}

/** Extract the CLI's single JSON result object from stdout (tolerates leading
 *  noise by scanning for the outermost balanced braces). */
export function parseClaudeJson(stdout) {
  const s = String(stdout).trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
