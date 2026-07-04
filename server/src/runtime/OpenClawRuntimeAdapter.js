// OpenClaw runtime — REAL subagent orchestration.
//
// This adapter executes each virtual employee as a genuine OpenClaw subagent
// (an isolated, persistent Gateway *session*) driven through the `openclaw` CLI.
// The manager (this backend / the main agent) seeds each employee with its
// persona + retrieved knowledge, runs the meeting/goal as real multi-turn agent
// turns, threads the subagents' contributions into one another, and asks a
// manager session to synthesize the final artifact. See ./openclaw/cli.js and
// ./openclaw/orchestrator.js for the mechanics.
//
// Live is the default success path. The SimulatedRuntimeAdapter is used ONLY as
// a fallback — when the OpenClaw CLI/Gateway is unreachable (or explicitly
// disabled via OPENCLAW_DISABLE) — and every fallback is clearly flagged in the
// returned `runtime` metadata (`fallback: true`, `live: false`, a note) so the
// UI and stored records never present a simulation as real execution.
import { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
import { SimulatedRuntimeAdapter } from './SimulatedRuntimeAdapter.js';
import * as cli from './openclaw/cli.js';
import * as orchestrator from './openclaw/orchestrator.js';
import { config } from '../config.js';

export class OpenClawRuntimeAdapter extends AgentRuntimeAdapter {
  #fallback = new SimulatedRuntimeAdapter();

  get mode() { return 'openclaw'; }

  get label() {
    // Sync best-effort: reflects the last probe (health() refreshes it).
    const live = cli.availableSync();
    if (live === false) return 'OpenClaw（模擬備援）';
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
    if (!(await cli.available())) return this.#simulatedFallback('runMeeting', req);
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
      return this.#simulatedFallback('runMeeting', req, err);
    }
  }

  async executeGoal(req) {
    if (!(await cli.available())) return this.#simulatedFallback('executeGoal', req);
    try {
      const r = await orchestrator.executeGoal(req);
      return {
        tasks: r.tasks,
        output: r.output,
        grounding: r.grounding,
        runtime: this.#liveRuntime(r.stats, r.grounding.length),
      };
    } catch (err) {
      return this.#simulatedFallback('executeGoal', req, err);
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
      engine: allDegraded ? 'simulated' : 'openclaw-cli',
      live: !allDegraded,
      fallback: allDegraded,
      grounded,
      liveTurns: stats.live,
      totalTurns: stats.total,
      model: stats.model,
      provider: stats.provider,
      note: allDegraded
        ? '所有子代理回合皆未能連上 OpenClaw，已以本機備援產出。'
        : `由 OpenClaw 真實子代理執行（${stats.live}/${stats.total} 回合為即時${stats.model ? `，模型：${stats.model}` : ''}）。`,
    };
  }

  // Full offline fallback: run the simulated adapter but relabel the result as an
  // OpenClaw fallback so the distinction is visible everywhere it is shown/stored.
  async #simulatedFallback(method, req, err) {
    const result = await this.#fallback[method](req);
    const reason = config.openclaw.disabled
      ? 'OpenClaw 已停用（OPENCLAW_DISABLE）；已在本機以模擬方式執行。'
      : err
        ? `OpenClaw 執行失敗（${err.message}）；已改用本機模擬備援。`
        : '找不到可用的 OpenClaw CLI／Gateway；已在本機以模擬方式執行。';
    return {
      ...result,
      runtime: {
        mode: this.mode,
        label: 'OpenClaw（模擬備援）',
        engine: 'simulated',
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
