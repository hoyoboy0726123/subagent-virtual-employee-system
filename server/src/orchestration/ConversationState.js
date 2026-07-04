// Conversation state for the standalone multi-agent runtime.
//
// The standalone runtime drives each virtual employee as a distinct in-app agent
// through stateless model calls (Google Gen AI). To make them behave like agents
// that *remember* and *respond to one another* across rounds — without any
// external session store — we keep the running conversation here and re-inject
// the relevant slice into every turn's prompt.
//
// `AgentTurn` is the single record shape shared by the orchestrator, the stored
// meeting transcript, and the UI. `ConversationState` is an ordered log of turns
// with a couple of helpers for building the context each next agent sees.

/**
 * @typedef {Object} AgentTurn
 * @property {number}  round        1-based round number
 * @property {string}  roundTitle   human label for the round
 * @property {string}  speaker      employee name
 * @property {string}  role         employee role title
 * @property {string}  speakerId    employee id
 * @property {string}  text         the agent's actual utterance
 * @property {boolean} live         true if produced by a live model turn (not the deterministic fallback)
 * @property {Array}   citations    knowledge chunks the agent was grounded on
 */

export class ConversationState {
  /** @param {{topic?: string, participants?: Array}} [meta] */
  constructor(meta = {}) {
    this.meta = meta;
    /** @type {AgentTurn[]} */
    this.turns = [];
  }

  /** Append a completed turn. @param {AgentTurn} turn */
  add(turn) {
    this.turns.push(turn);
    return turn;
  }

  get length() {
    return this.turns.length;
  }

  /** Has anyone spoken yet? */
  get isEmpty() {
    return this.turns.length === 0;
  }

  /** Names of everyone who has spoken so far, in order (deduped). */
  priorSpeakers() {
    return [...new Set(this.turns.map((t) => t.speaker))];
  }

  /**
   * A compact digest of the most recent turns, for injection into the next
   * agent's prompt so it can genuinely respond to what was said.
   * @param {number} [n]  how many trailing turns to include
   */
  digest(n = 8) {
    if (this.isEmpty) return '（你是本場討論第一位發言者。）';
    return this.turns
      .slice(-n)
      .map((t) => `${t.speaker}（${t.role}）：${t.text}`)
      .join('\n');
  }

  /** The full ordered transcript, ready to store on a meeting record. */
  transcript() {
    return this.turns;
  }
}
