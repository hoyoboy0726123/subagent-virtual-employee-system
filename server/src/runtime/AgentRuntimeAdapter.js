// Runtime / orchestration layer.
//
// An AgentRuntimeAdapter is the seam between the app's *intent* ("run this
// meeting", "execute this goal") and *how* each virtual employee (subagent) is
// actually driven. The manager is the main agent; employees are subagents. The
// service layer never talks to the engine or an external orchestrator directly —
// it asks the currently-selected runtime adapter to do the work.
//
// Concrete adapters:
//   • StandaloneRuntimeAdapter — built-in multi-agent orchestration, DEFAULT.
//     Runs each employee as an in-app agent via Google Gen AI, with a
//     deterministic offline fallback. No external runtime required.
//   • OpenClawRuntimeAdapter   — OPTIONAL external adapter: each employee runs as
//     a real OpenClaw subagent/session via the `openclaw` CLI → Gateway.
//
// This abstraction is intentionally small and stable so the implementations are
// interchangeable and a third could be added without touching services or routes.

/**
 * @typedef {Object} MeetingRequest
 * @property {string} topic
 * @property {Array<{id,name,roleTitle,expertise,...}>} participants
 * @property {number} rounds
 *
 * @typedef {Object} MeetingResult
 * @property {Array} transcript
 * @property {Object} minutes
 * @property {string} report
 * @property {Array}  grounding   retrieved knowledge chunks used
 * @property {Object} runtime     {mode,label,grounded,fallback}
 *
 * @typedef {Object} GoalRequest
 * @property {string} title
 * @property {string} description
 * @property {Array}  assignees
 *
 * @typedef {Object} GoalResult
 * @property {Array}  tasks
 * @property {string} output
 * @property {Array}  grounding
 * @property {Object} runtime
 */

export class AgentRuntimeAdapter {
  /** Stable identifier, e.g. 'standalone' | 'openclaw'. */
  get mode() {
    throw new Error('AgentRuntimeAdapter.mode must be implemented');
  }

  /** Human-readable label for the UI. */
  get label() {
    return this.mode;
  }

  /** Liveness/config info shown on the health endpoint. */
  async health() {
    return { mode: this.mode, label: this.label, ready: true };
  }

  /**
   * Orchestrate a multi-employee discussion.
   * @param {MeetingRequest} _req
   * @returns {Promise<MeetingResult>}
   */
  async runMeeting(_req) {
    throw new Error(`${this.mode}: runMeeting not implemented`);
  }

  /**
   * Decompose and execute a goal across assignees.
   * @param {GoalRequest} _req
   * @returns {Promise<GoalResult>}
   */
  async executeGoal(_req) {
    throw new Error(`${this.mode}: executeGoal not implemented`);
  }
}
