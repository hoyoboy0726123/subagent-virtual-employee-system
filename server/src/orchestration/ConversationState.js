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
// with helpers for building the context each next agent sees. Phase 8 makes that
// context *agent-aware*: it separates what YOU (the next speaker) already said
// from what OTHERS said, and singles out the person you're answering — so turns
// read like a real conversation instead of parallel monologues.

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

  /** The most recent turn overall — the person the next speaker is answering. */
  lastTurn() {
    return this.turns[this.turns.length - 1] || null;
  }

  /** Every turn a given speaker has taken so far (their own prior positions). */
  turnsBy(name) {
    return this.turns.filter((t) => t.speaker === name);
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
      .map((t) => `第${t.round}輪 · ${t.speaker}（${t.role}）：${t.text}`)
      .join('\n');
  }

  /**
   * An agent-aware view of the recent conversation used to pack the next turn's
   * prompt. Unlike a flat digest, this pulls apart the pieces that make a reply
   * feel earned:
   *   • `previousSpeaker` — the last *other* person, so this agent can answer a
   *     specific someone by name instead of the room in general;
   *   • `myLastPoint` — this agent's own most recent stance, so it stays
   *     consistent across rounds instead of contradicting itself;
   *   • `othersDigest` — only what other people said (no echoing yourself);
   *   • `spokenSoFar` — who else is in the thread already.
   *
   * @param {string} name             the next speaker's name
   * @param {object} [opts]
   * @param {number} [opts.window]    how many trailing turns to consider
   * @returns {{
   *   isFirstOverall: boolean,
   *   transcriptDigest: string|null,
   *   othersDigest: string|null,
   *   previousSpeaker: {name:string, role:string, text:string}|null,
   *   myLastPoint: string|null,
   *   spokenSoFar: string[],
   * }}
   */
  contextFor(name, { window = 6 } = {}) {
    const recent = this.turns.slice(-window);
    const others = recent.filter((t) => t.speaker !== name);
    const mine = this.turnsBy(name);
    const previous = [...this.turns].reverse().find((t) => t.speaker !== name) || null;
    const line = (t) => `${t.speaker}（${t.role}）：${t.text}`;

    return {
      isFirstOverall: this.isEmpty,
      transcriptDigest: recent.length ? recent.map(line).join('\n') : null,
      othersDigest: others.length ? others.map(line).join('\n') : null,
      previousSpeaker: previous
        ? { name: previous.speaker, role: previous.role, text: previous.text }
        : null,
      myLastPoint: mine.length ? mine[mine.length - 1].text : null,
      spokenSoFar: this.priorSpeakers().filter((n) => n !== name),
    };
  }

  /** The full ordered transcript, ready to store on a meeting record. */
  transcript() {
    return this.turns;
  }
}
