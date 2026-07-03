// OpenClaw runtime (real subagent orchestration) — STUBBED by default.
//
// This is where the product is heading: the manager (main agent) spawns each
// virtual employee as a real OpenClaw *subagent*, hands it the meeting/goal
// context plus its retrieved knowledge, and collects the results. Until that
// live integration is wired up, this adapter transparently falls back to the
// SimulatedRuntimeAdapter so every flow keeps working offline — but it tags its
// output with `fallback: true` and `mode: 'openclaw'` so the UI and stored
// records make the simulation explicit.
//
// TO GO LIVE, implement the three private methods below (#spawnSubagent,
// #dispatchTurn, #collectArtifact) against the OpenClaw API/CLI and flip
// `configured()` on by setting OPENCLAW_ENDPOINT. Nothing else in the app needs
// to change — services and routes only depend on the AgentRuntimeAdapter shape.
import { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
import { SimulatedRuntimeAdapter } from './SimulatedRuntimeAdapter.js';
import { groundingFor } from '../storage/retrieval.js';
import { config, openclawConfigured } from '../config.js';

export class OpenClawRuntimeAdapter extends AgentRuntimeAdapter {
  #fallback = new SimulatedRuntimeAdapter();

  get mode() { return 'openclaw'; }
  get label() { return openclawConfigured() ? 'OpenClaw（即時）' : 'OpenClaw（模擬備援）'; }

  configured() {
    return openclawConfigured();
  }

  async health() {
    return {
      mode: this.mode,
      label: this.label,
      ready: true,                 // always ready — falls back when not configured
      live: this.configured(),
      endpoint: config.openclaw.endpoint || null,
    };
  }

  async runMeeting(req) {
    if (!this.configured()) return this.#simulatedFallback('runMeeting', req);

    // --- LIVE PATH (to implement) -------------------------------------------
    // 1. Pre-retrieve each employee's grounding so subagents get scoped context.
    const { byEmployee, flat } = groundingFor({ query: req.topic, employees: req.participants });
    // 2. Spawn one subagent per participant.
    //    const agents = await Promise.all(req.participants.map((p) =>
    //      this.#spawnSubagent(p, byEmployee[p.id])));
    // 3. Run `req.rounds` discussion turns, dispatching context to each subagent
    //    and threading prior turns back in (this is the real multi-agent loop).
    //    const transcript = await this.#runRounds(agents, req);
    // 4. Ask the manager agent to synthesize minutes + report from the transcript.
    //    const { minutes, report } = await this.#collectArtifact('meeting', transcript);
    // 5. Return the same shape SimulatedRuntimeAdapter returns, with
    //    runtime.mode = 'openclaw', runtime.fallback = false, grounding = flat.
    void byEmployee; void flat;
    throw new Error('OpenClawRuntimeAdapter.runMeeting: live path not implemented');
  }

  async executeGoal(req) {
    if (!this.configured()) return this.#simulatedFallback('executeGoal', req);

    // --- LIVE PATH (to implement) -------------------------------------------
    // Spawn one subagent per assignee, dispatch the goal + their grounding, have
    // each produce its subtask artifact, then synthesize the collaboration
    // output via the manager agent. Same return shape as the simulated adapter.
    throw new Error('OpenClawRuntimeAdapter.executeGoal: live path not implemented');
  }

  // Run the simulated adapter but relabel the result as an OpenClaw fallback so
  // the distinction is visible everywhere the record is shown/stored.
  async #simulatedFallback(method, req) {
    const result = await this.#fallback[method](req);
    return {
      ...result,
      runtime: {
        mode: this.mode,
        label: this.label,
        grounded: result.grounding?.length || 0,
        fallback: true,
        note: '尚未設定 OpenClaw（請設定 OPENCLAW_ENDPOINT）；已在本機以模擬方式執行。',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Real-integration plug points. These are the ONLY methods a live OpenClaw
  // implementation needs to fill in. Signatures are intentionally concrete so
  // the wiring is obvious.
  // ---------------------------------------------------------------------------

  /**
   * Spawn one OpenClaw subagent for a virtual employee, seeded with its persona
   * and retrieved knowledge.
   * @param {object} _employee                the persona (system-prompt material)
   * @param {Array}  _grounding               retrieved knowledge chunks for scope
   * @returns {Promise<{agentId:string}>}
   */
  async #spawnSubagent(_employee, _grounding) {
    // TODO: call OpenClaw to create a subagent, e.g.
    //   POST {OPENCLAW_ENDPOINT}/subagents { systemPrompt, tools, context }
    // Return a handle used by #dispatchTurn / #collectArtifact.
    throw new Error('not implemented');
  }

  /**
   * Send a single discussion/work turn to a subagent and await its reply.
   * @param {{agentId:string}} _agent
   * @param {object} _turnContext   {topic|goal, round, priorTurns, ...}
   * @returns {Promise<{text:string, citations?:Array}>}
   */
  async #dispatchTurn(_agent, _turnContext) {
    // TODO: POST a message to the subagent and return its structured reply.
    throw new Error('not implemented');
  }

  /**
   * Ask the manager (main) agent to synthesize a final artifact from raw turns.
   * @param {'meeting'|'goal'} _kind
   * @param {Array} _rawTurns
   * @returns {Promise<object>}   {minutes,report} | {tasks,output}
   */
  async #collectArtifact(_kind, _rawTurns) {
    // TODO: run a synthesis pass on the manager agent.
    throw new Error('not implemented');
  }
}
