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
import { planRoundOrder } from './MeetingChair.js';
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
// Forced-convergence plan (the "限時收斂結束" button): a few narrowing rounds
// that MUST stop opening new threads, ending in a decisive close. Prevents an
// open-ended discussion from never converging.
const CONVERGE_ROUND = { title: '收斂中', goal: '收斂尚未定案的爭點，把能拍板的先拍板；不要開啟新議題，聚焦在做決定' };
const FINAL_CLOSE_ROUND = { title: '定案與待辦', goal: '產出最終決議、每項待辦的負責人與檢查點時間；只講可執行的結論，不再延伸新議題' };

/** N rounds that force convergence: (N-1) narrowing rounds + 1 decisive close. */
export function planConvergeRounds(n) {
  const rounds = Math.min(Math.max(Number(n) || 3, 1), 3);
  return [...Array.from({ length: rounds - 1 }, () => CONVERGE_ROUND), FINAL_CLOSE_ROUND];
}

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
export async function runMeetingRounds({ topic, participants, rounds, priorTranscript = [], roundPlan = null, outputMode = 'full', agenda = '', quick = false, runId, onEvent, signal }) {
  const emit = (e) => { try { onEvent?.(e); } catch { /* streaming must not break the run */ } };
  // Register the interjection mailbox SYNCHRONOUSLY, before the run event is
  // emitted — so a manager who interjects the instant they receive the runId
  // can never hit a not-yet-registered window (BUG: notes were lost + leaked).
  if (runId) {
    interjectionQueues.set(runId, []);
    emit({ type: 'run', runId });
  }
  // Quick meeting: agents speak from ROLE only — skip the knowledge-base
  // retrieval entirely (faster, shallower, by design).
  const { byEmployee, flat } = quick
    ? { byEmployee: {}, flat: [] }
    : await groundingFor({ query: topic, employees: participants });
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');

  const convo = new ConversationState({ topic, participants });
  for (const t of priorTranscript) convo.add(t);
  const startRound = priorTranscript.reduce((m, t) => Math.max(m, t.round || 0), 0);

  // First segment gets the open→analyse→decide arc; continuation segments are
  // all deepening — the MANAGER decides when the meeting actually closes.
  // An explicit roundPlan (e.g. forced convergence) wins; otherwise a first
  // segment gets the open→analyse→decide arc, continuations deepen.
  let plan = roundPlan || (startRound === 0 ? planRounds(rounds) : Array.from({ length: rounds }, () => DEEPEN_ROUND));
  // Conclusion mode: nudge every round toward a decisive answer with no new
  // threads — this is where divergence is actually curbed (the report side just
  // omits action items).
  if (outputMode === 'conclusion') {
    plan = plan.map((r) => ({ ...r, goal: `${r.goal}。（本會議為結論模式：聚焦收斂出當前最終結論，給出明確判斷即可，不要開啟新議題，也不必列出行動項目或指派負責人）` }));
  }
  const stats = newStats();

  try {
    for (let r = 0; r < rounds; r++) {
      if (signal?.aborted) break; // client left — stop; completed rounds are kept
      const roundNo = startRound + r + 1;
      const { title: roundTitle, goal: roundGoal } = plan[r] || DEEPEN_ROUND;
      emit({ type: 'round', round: roundNo, roundTitle, roundGoal });

      // The manager agent chairs the round — ONE call plans the whole round's
      // speaking order (+ optional per-person follow-ups); everyone still speaks
      // exactly once. Offline this degrades to the deterministic input order.
      const plannedRound = await planRoundOrder({ topic, roundTitle, roundGoal, convo, participants });
      for (const pick of plannedRound.order) {
        if (signal?.aborted) break; // stop between speakers too, to save calls
        // The human manager's live interjections take the floor first.
        drainInterjections(runId, convo, roundNo, roundTitle, emit);

        const emp = pick.employee;
        const view = convo.contextFor(emp.name, { window: Math.max(participants.length, 4) });
        // Surface the manager's most recent interjection as a binding directive.
        const managerTurns = convo.turns.filter((t) => t.isManager);
        const managerDirective = managerTurns.length ? managerTurns[managerTurns.length - 1].text : null;

        const turn = await executor.meetingTurn({
          employee: emp,
          grounding: byEmployee[emp.id] || [],
          context: {
            topic,
            agenda,
            quick,
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
          pickedBy: plannedRound.live ? 'manager' : 'sequence',
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
 * Run ONE turn for a specific employee the human manager called on ("點名").
 * Rebuilds the conversation view from the stored transcript, retrieves that
 * employee's grounding, and asks them to answer — the manager's question (or a
 * generic "you were called on") lands as a binding directive, so they respond
 * directly. Returns the raw turn; the caller appends + persists it.
 */
export async function directedTurn({ topic, participants, priorTranscript = [], employeeId, question }) {
  const emp = participants.find((p) => p.id === employeeId);
  if (!emp) throw new Error('該員工不在這場會議中');

  const { byEmployee } = await groundingFor({ query: question || topic, employees: participants });
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');

  const convo = new ConversationState({ topic, participants });
  for (const t of priorTranscript) convo.add(t);
  const round = priorTranscript.reduce((m, t) => Math.max(m, t.round || 0), 0) || 1;
  const managerTurns = convo.turns.filter((t) => t.isManager);
  const managerDirective = managerTurns.length ? managerTurns[managerTurns.length - 1].text : null;

  const turn = await executor.meetingTurn({
    employee: emp,
    grounding: byEmployee[emp.id] || [],
    context: {
      topic,
      round,
      roundTitle: '主管點名',
      roundGoal: '回應主管的直接點名',
      participantList,
      managerQuestion: question || '主管直接點名你發言，請針對目前的討論給出你的專業意見與立場。',
      managerDirective,
      convo: convo.contextFor(emp.name, { window: Math.max(participants.length, 4) }),
      priorSpeakers: convo.priorSpeakers().filter((n) => n !== emp.name),
    },
  });
  return { employee: emp, turn };
}

/**
 * Conclude a meeting (Phase 16): the MANAGER decided the discussion is done —
 * only now are the minutes/report synthesized from the full transcript.
 * @param {object} req  { topic, participants, transcript, grounding?, onEvent? }
 * @returns {Promise<{minutes, report, stats}>}
 */
export async function concludeMeeting({ topic, participants, transcript, grounding = [], onEvent, outputMode = 'full', agenda = '' }) {
  const emit = (e) => { try { onEvent?.(e); } catch { /* ignore */ } };
  emit({ type: 'synthesizing' });
  const stats = newStats();
  const minutes = engine.buildMinutes({ topic, participants, transcript });
  // Conclusion mode: the meeting produces a final decision/recommendation only —
  // drop action items so nothing spins into goals and the fallback stays todo-free.
  if (outputMode === 'conclusion') minutes.actionItems = [];
  const report = await synthesizeMeetingReport({ topic, participants, transcript, minutes, grounding, outputMode, agenda });
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
