// MeetingOrchestrator — a real, built-in, multi-round multi-agent meeting.
//
// This is the standalone runtime's answer to "meetings should be real
// orchestrated multi-agent conversations, not placeholders". For each round, and
// for each participant, it:
//   1. grounds the employee in *their own* retrieved knowledge (RAG),
//   2. injects an agent-aware slice of the running conversation
//      (ConversationState.contextFor) so they respond to who spoke last and stay
//      consistent with their own earlier stance,
//   3. runs a genuine agent turn via EmployeeAgentExecutor with a per-round
//      behavioural stance (open → challenge → commit).
// Then a coordinating manager agent (ReportSynthesizer) writes the report from
// the REAL transcript, with the retrieved knowledge in view. Everything happens
// in-process — no external Gateway.
import { ConversationState } from './ConversationState.js';
import * as executor from './EmployeeAgentExecutor.js';
import { synthesizeMeetingReport } from './ReportSynthesizer.js';
import { pickNextSpeaker } from './MeetingChair.js';
import { groundingFor } from '../storage/retrieval.js';
import * as engine from '../reasoning/engine.js';

// Round scaffold: a human title, the substantive goal for the round, and the
// shape the round should take. The orchestrator picks a coherent subset for the
// requested round count so short and long meetings both arc sensibly.
const ROUND_LIBRARY = [
  { title: '開場立場', goal: '釐清成功標準、關鍵限制，以及你最在意的一個風險' },
  { title: '分析與風險', goal: '針對彼此的論點深入分析主要風險與取捨，同意或反對都要給理由' },
  { title: '決議與後續步驟', goal: '收斂為具體決議、負責人與可驗收的下一步' },
];
const DEEPEN_ROUND = { title: '深化與整合', goal: '深化尚未解決的爭點，提出能整合各方的方案' };
const CLOSE_ROUND = { title: '收斂與定案', goal: '對齊最終定案、負責人與檢查點時間' };

// Build a round plan of exactly `rounds` entries that always opens with a
// position round and ends on a decision/close round (the arc that makes a
// meeting feel like it went somewhere).
function planRounds(rounds) {
  if (rounds <= 3) return ROUND_LIBRARY.slice(0, rounds);
  const middle = [];
  for (let i = 0; i < rounds - 3; i++) middle.push(DEEPEN_ROUND);
  return [ROUND_LIBRARY[0], ROUND_LIBRARY[1], ...middle, ROUND_LIBRARY[2], CLOSE_ROUND].slice(0, rounds);
}

// ---------------------------------------------------------------------------
// Live interjection mailbox (Phase 16). While a discussion segment is running,
// the MANAGER (the human user) can post a note at any time; it is drained
// before the next speaker turn, lands in the transcript as a manager turn, and
// steers every subsequent agent (via ConversationState + managerDirective).
// Keyed by the caller-supplied runId; process-local, like the run itself.
// ---------------------------------------------------------------------------
const interjectionQueues = new Map();

// Deliver a live interjection — ONLY to a run that has registered its mailbox
// (i.e. is actually streaming right now). Returning false for an unknown/stale
// runId is what lets the service fall back to the stored path instead of
// silently losing the note (and leaking a Map entry that no run ever drains).
export function interject(runId, text) {
  const note = String(text || '').trim();
  if (!runId || !note || !interjectionQueues.has(runId)) return false;
  interjectionQueues.get(runId).push(note);
  return true;
}

const MANAGER_TURN = { speaker: '主管', role: '會議主持人', speakerId: 'manager' };

function drainInterjections(runId, convo, roundNo, roundTitle, emit) {
  const queue = runId ? interjectionQueues.get(runId) : null;
  if (!queue || !queue.length) return;
  while (queue.length) {
    const added = convo.add({
      round: roundNo,
      roundTitle,
      ...MANAGER_TURN,
      text: queue.shift(),
      live: true,
      isManager: true,
      toolCalls: 0,
      citations: [],
    });
    emit({ type: 'turn', turn: added });
  }
}

/**
 * Run discussion rounds WITHOUT concluding (Phase 16). Appends to an existing
 * transcript when `priorTranscript` is given (繼續討論), so round numbering and
 * every agent's memory of the conversation carry over.
 *
 * @param {object} req  { topic, participants, rounds, priorTranscript?, runId?, onEvent?, signal? }
 *   signal — AbortSignal wired to the client connection (C2): when the manager
 *   closes the tab we stop at the next round boundary and persist what ran,
 *   instead of burning the rest of the LLM calls into a dead socket.
 * @returns {Promise<{transcript, grounding, stats}>}
 */
export async function runMeetingRounds({ topic, participants, rounds, priorTranscript = [], runId, onEvent, signal }) {
  const emit = (e) => { try { onEvent?.(e); } catch { /* streaming must not break the run */ } };
  // Register the interjection mailbox SYNCHRONOUSLY, before the run event is
  // emitted — so a manager who interjects the instant they receive the runId
  // can never hit a not-yet-registered window (BUG: notes were lost + leaked).
  if (runId) {
    interjectionQueues.set(runId, []);
    emit({ type: 'run', runId });
  }
  const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');

  const convo = new ConversationState({ topic, participants });
  for (const t of priorTranscript) convo.add(t);
  const startRound = priorTranscript.reduce((m, t) => Math.max(m, t.round || 0), 0);

  // First segment gets the open→analyse→decide arc; continuation segments are
  // all deepening — the MANAGER decides when the meeting actually closes.
  const plan = startRound === 0 ? planRounds(rounds) : Array.from({ length: rounds }, () => DEEPEN_ROUND);
  const stats = newStats();

  try {
    for (let r = 0; r < rounds; r++) {
      if (signal?.aborted) break; // client left — stop; completed rounds are kept
      const roundNo = startRound + r + 1;
      const { title: roundTitle, goal: roundGoal } = plan[r] || DEEPEN_ROUND;
      emit({ type: 'round', round: roundNo, roundTitle, roundGoal });

      // The manager agent chairs the round — it picks WHO speaks next (and may
      // attach a follow-up question). Everyone still speaks once per round;
      // offline this degrades to the deterministic order.
      const remaining = [...participants];
      while (remaining.length) {
        if (signal?.aborted) break; // stop between speakers too, to save calls
        // The human manager's live interjections take the floor first.
        drainInterjections(runId, convo, roundNo, roundTitle, emit);

        const pick = await pickNextSpeaker({ topic, roundTitle, roundGoal, convo, remaining });
        const emp = pick.employee;
        remaining.splice(remaining.indexOf(emp), 1);

        const view = convo.contextFor(emp.name, { window: Math.max(participants.length, 4) });
        // Surface the manager's most recent interjection as a binding directive.
        const managerTurns = convo.turns.filter((t) => t.isManager);
        const managerDirective = managerTurns.length ? managerTurns[managerTurns.length - 1].text : null;

        const turn = await executor.meetingTurn({
          employee: emp,
          grounding: byEmployee[emp.id] || [],
          context: {
            topic,
            rounds: startRound + rounds,
            round: roundNo - 1,
            roundTitle,
            roundGoal,
            participantList,
            managerQuestion: pick.question,
            managerDirective,
            convo: view,
            priorSpeakers: convo.priorSpeakers().filter((n) => n !== emp.name),
          },
        });
        record(stats, turn.live);
        const added = convo.add({
          round: roundNo,
          roundTitle,
          speaker: emp.name,
          role: emp.roleTitle,
          speakerId: emp.id,
          text: turn.text,
          live: turn.live,
          toolCalls: turn.toolCalls || 0,
          pickedBy: pick.live ? 'manager' : 'sequence',
          managerQuestion: pick.question || null,
          citations: turn.citations,
        });
        emit({ type: 'turn', turn: added });
      }
    }
    // Anything the manager said after the final turn still enters the record.
    drainInterjections(runId, convo, startRound + rounds, '討論中', emit);
  } finally {
    if (runId) interjectionQueues.delete(runId);
  }

  return { transcript: convo.transcript(), grounding: flat, stats };
}

/**
 * Conclude a meeting (Phase 16): the MANAGER decided the discussion is done —
 * only now are the minutes/report synthesized from the full transcript.
 * @param {object} req  { topic, participants, transcript, grounding?, onEvent? }
 * @returns {Promise<{minutes, report, stats}>}
 */
export async function concludeMeeting({ topic, participants, transcript, grounding = [], onEvent }) {
  const emit = (e) => { try { onEvent?.(e); } catch { /* ignore */ } };
  emit({ type: 'synthesizing' });
  const stats = newStats();
  const minutes = engine.buildMinutes({ topic, participants, transcript });
  const report = await synthesizeMeetingReport({ topic, participants, transcript, minutes, grounding });
  record(stats, report.live);
  return { minutes, report: report.text, stats };
}

/**
 * Legacy one-shot meeting (API compatibility + OpenClaw parity): rounds then an
 * immediate conclusion, exactly as before Phase 16.
 * @param {object} req  { topic, participants, rounds, onEvent? }
 * @returns {Promise<{transcript, minutes, report, grounding, stats}>}
 */
export async function runMeeting({ topic, participants, rounds, onEvent, signal }) {
  const ran = await runMeetingRounds({ topic, participants, rounds, onEvent, signal });
  const done = await concludeMeeting({
    topic, participants, transcript: ran.transcript, grounding: ran.grounding, onEvent,
  });
  const stats = { ...ran.stats, total: ran.stats.total + done.stats.total, live: ran.stats.live + done.stats.live };
  return { transcript: ran.transcript, minutes: done.minutes, report: done.report, grounding: ran.grounding, stats };
}

export function newStats() {
  const { model, provider } = executor.agentModel();
  return { total: 0, live: 0, model, provider };
}

export function record(stats, live) {
  stats.total++;
  if (live) stats.live++;
}
