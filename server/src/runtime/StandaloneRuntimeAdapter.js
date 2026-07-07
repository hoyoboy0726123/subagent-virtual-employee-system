// Standalone runtime — the DEFAULT, built-in multi-agent orchestration.
//
// This is the product's primary execution path and requires NO external runtime
// (no OpenClaw, no Gateway). The system itself orchestrates each virtual employee
// as a distinct in-app agent — persona + employee-scoped retrieved knowledge +
// live conversation context — and drives genuine multi-turn conversations and
// collaborative goals through Google Gen AI (`gemma-4-31b-it`). A coordinating
// manager agent synthesizes the final report/output from the real transcript.
//
// It is also robust offline: when no Google API key is configured (or a turn
// fails), each agent turn degrades to the deterministic engine, and the runtime
// metadata says so honestly (`live`/`liveTurns`) — the orchestration itself is
// always real, only the per-turn reasoning backend changes.
//
// See ../orchestration/ for the mechanics: MeetingOrchestrator, GoalCoordinator,
// EmployeeAgentExecutor, ReportSynthesizer, ConversationState.
import { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
import * as meetingOrchestrator from '../orchestration/MeetingOrchestrator.js';
import * as goalCoordinator from '../orchestration/GoalCoordinator.js';
import { llmEnabled } from '../reasoning/llm.js';
import { config } from '../config.js';

export class StandaloneRuntimeAdapter extends AgentRuntimeAdapter {
  get mode() { return 'standalone'; }

  get label() {
    return llmEnabled() ? `內建多代理（${config.llm.model}）` : '內建多代理（離線推理）';
  }

  async health() {
    return {
      mode: this.mode,
      label: this.label,
      ready: true,           // always ready — the whole point is no external dependency
      live: llmEnabled(),    // true when agent turns run on the live model
      engine: llmEnabled() ? 'standalone-genai' : 'deterministic',
      llm: llmEnabled(),
      model: llmEnabled() ? config.llm.model : null,
      provider: llmEnabled() ? config.llm.provider : null,
    };
  }

  async runMeeting(req) {
    const r = await meetingOrchestrator.runMeeting(req);
    return {
      transcript: r.transcript,
      minutes: r.minutes,
      report: r.report,
      grounding: r.grounding,
      runtime: this.#runtime(r.stats, r.grounding.length),
    };
  }

  // Phase 16 — manager-chaired lifecycle: run discussion rounds WITHOUT
  // concluding (the human manager decides what happens next).
  async runMeetingRounds(req) {
    const r = await meetingOrchestrator.runMeetingRounds(req);
    return {
      transcript: r.transcript,
      grounding: r.grounding,
      runtime: this.#runtime(r.stats, r.grounding.length),
    };
  }

  // Phase 16 — the manager decided to conclude: synthesize minutes + report.
  async concludeMeeting(req) {
    const r = await meetingOrchestrator.concludeMeeting(req);
    return {
      minutes: r.minutes,
      report: r.report,
      runtime: this.#runtime(r.stats, req.grounding?.length || 0),
    };
  }

  async executeGoal(req) {
    const r = await goalCoordinator.executeGoal(req);
    return {
      tasks: r.tasks,
      output: r.output,
      grounding: r.grounding,
      runtime: this.#runtime(r.stats, r.grounding.length),
    };
  }

  // Honest runtime metadata. `fallback` is true only when NOT A SINGLE turn ran
  // on the live model (the whole run used the deterministic engine) — in which
  // case the record is deterministic and says so. The shape mirrors the OpenClaw
  // adapter so the UI badges are uniform.
  #runtime(stats, grounded) {
    const anyLive = stats.live > 0;
    return {
      mode: this.mode,
      label: this.label,
      engine: anyLive ? 'standalone-genai' : 'deterministic',
      live: anyLive,
      fallback: !anyLive,
      grounded,
      liveTurns: stats.live,
      totalTurns: stats.total,
      model: anyLive ? stats.model : null,
      provider: anyLive ? stats.provider : null,
      note: anyLive
        ? `由內建多代理協作執行（${stats.live}/${stats.total} 回合為即時模型${stats.model ? `，模型：${stats.model}` : ''}）。`
        : '未設定 Google API 金鑰，已由內建的離線推理引擎（persona + RAG）產出，仍為真實的多輪多代理編排。',
    };
  }
}
