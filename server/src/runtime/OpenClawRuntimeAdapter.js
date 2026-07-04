// OpenClaw runtime — OPTIONAL external adapter (real subagent orchestration).
//
// This is NOT the product's default path. The default is the built-in standalone
// runtime (see StandaloneRuntimeAdapter). This adapter is an opt-in integration
// for teams that already run an OpenClaw Gateway and want each virtual employee
// executed as a genuine OpenClaw subagent (an isolated, persistent Gateway
// *session*) driven through the `openclaw` CLI. When selected, the manager seeds
// each employee with its persona + retrieved knowledge, runs the meeting/goal as
// real multi-turn agent turns threading the subagents' contributions into one
// another, and asks a manager session to synthesize the final artifact. See
// ./openclaw/cli.js and ./openclaw/orchestrator.js for the mechanics.
//
// When this adapter is active but the CLI/Gateway is unreachable (or explicitly
// disabled via OPENCLAW_DISABLE), it degrades to the built-in deterministic
// engine, and every fallback is clearly flagged in the returned `runtime`
// metadata (`fallback: true`, `live: false`, a note) so the UI and stored records
// never present a fallback as real OpenClaw execution.
import { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
import { deterministicMeeting, deterministicGoal } from '../orchestration/deterministic.js';
import * as cli from './openclaw/cli.js';
import * as orchestrator from './openclaw/orchestrator.js';
import { config } from '../config.js';

export class OpenClawRuntimeAdapter extends AgentRuntimeAdapter {
  get mode() { return 'openclaw'; }

  get label() {
    // Sync best-effort: reflects the last probe (health() refreshes it).
    const live = cli.availableSync();
    if (live === false) return 'OpenClaw（離線備援）';
    if (live === true) return 'OpenClaw（即時子代理）';
    return 'OpenClaw';
  }

  async configured() {
    return cli.available();
  }

  async health() {
    const s = await cli.status();
    return {
      mode: this.mode,
      label: this.label,
      ready: true,            // always ready — falls back when the CLI is down
      live: s.available,      // true only when the real OpenClaw CLI is reachable
      engine: s.available ? 'openclaw-cli' : 'simulated',
      cli: s.cli,
      version: s.version,
      agents: s.agents,
      gateway: Array.isArray(s.agents) ? 'ok' : (s.available ? 'unknown' : 'down'),
      error: s.error,
      disabled: config.openclaw.disabled,
    };
  }

  async runMeeting(req) {
    if (!(await cli.available())) return this.#offlineFallback('meeting', req);
    try {
      const r = await orchestrator.runMeeting(req);
      return {
        transcript: r.transcript,
        minutes: r.minutes,
        report: r.report,
        grounding: r.grounding,
        runtime: this.#liveRuntime(r.stats, r.grounding.length),
      };
    } catch (err) {
      return this.#offlineFallback('meeting', req, err);
    }
  }

  async executeGoal(req) {
    if (!(await cli.available())) return this.#offlineFallback('goal', req);
    try {
      const r = await orchestrator.executeGoal(req);
      return {
        tasks: r.tasks,
        output: r.output,
        grounding: r.grounding,
        runtime: this.#liveRuntime(r.stats, r.grounding.length),
      };
    } catch (err) {
      return this.#offlineFallback('goal', req, err);
    }
  }

  // Honest runtime metadata for a real OpenClaw run. `fallback` is true only if
  // NOT A SINGLE turn executed live (i.e. every subagent turn had to degrade),
  // in which case the record is effectively simulated and says so.
  #liveRuntime(stats, grounded) {
    const allDegraded = stats.live === 0;
    return {
      mode: this.mode,
      label: this.label,
      engine: allDegraded ? 'deterministic' : 'openclaw-cli',
      live: !allDegraded,
      fallback: allDegraded,
      grounded,
      liveTurns: stats.live,
      totalTurns: stats.total,
      model: stats.model,
      provider: stats.provider,
      note: allDegraded
        ? '所有子代理回合皆未能連上 OpenClaw，已以本機離線引擎產出。'
        : `由 OpenClaw 真實子代理執行（${stats.live}/${stats.total} 回合為即時${stats.model ? `，模型：${stats.model}` : ''}）。`,
    };
  }

  // Whole-run offline fallback: produce the result with the built-in deterministic
  // engine but relabel it as an OpenClaw fallback so the distinction is visible
  // everywhere it is shown/stored.
  #offlineFallback(kind, req, err) {
    const result = kind === 'meeting' ? deterministicMeeting(req) : deterministicGoal(req);
    const reason = config.openclaw.disabled
      ? 'OpenClaw 已停用（OPENCLAW_DISABLE）；已在本機以離線引擎執行。'
      : err
        ? `OpenClaw 執行失敗（${err.message}）；已改用本機離線引擎備援。`
        : '找不到可用的 OpenClaw CLI／Gateway；已在本機以離線引擎執行。';
    return {
      ...result,
      runtime: {
        mode: this.mode,
        label: 'OpenClaw（離線備援）',
        engine: 'deterministic',
        live: false,
        grounded: result.grounding?.length || 0,
        liveTurns: 0,
        totalTurns: 0,
        fallback: true,
        note: reason,
      },
    };
  }
}
