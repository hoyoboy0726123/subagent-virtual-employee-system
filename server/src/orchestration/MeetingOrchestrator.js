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

/**
 * @param {object} req  { topic, participants, rounds, onEvent? }
 *   onEvent — optional live-progress callback (Phase 15 streaming): receives
 *   {type:'round'|'turn'|'synthesizing', ...} as the meeting unfolds. Callback
 *   errors are swallowed so streaming can never break the meeting itself.
 * @returns {Promise<{transcript, minutes, report, grounding, stats}>}
 */
export async function runMeeting({ topic, participants, rounds, onEvent }) {
  const emit = (e) => { try { onEvent?.(e); } catch { /* streaming must not break the run */ } };
  const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');
  const plan = planRounds(rounds);

  const convo = new ConversationState({ topic, participants });
  const stats = newStats();

  for (let r = 0; r < rounds; r++) {
    const { title: roundTitle, goal: roundGoal } = plan[r] || { title: `第 ${r + 1} 輪`, goal: '收斂結論' };
    emit({ type: 'round', round: r + 1, rounds, roundTitle, roundGoal });

    // Phase 15: the manager agent chairs the round — it picks WHO speaks next
    // (and may attach a follow-up question) from those yet to speak. Everyone
    // still speaks exactly once per round; offline this degrades to the
    // original deterministic order.
    const remaining = [...participants];
    while (remaining.length) {
      const pick = await pickNextSpeaker({ topic, roundTitle, roundGoal, convo, remaining });
      const emp = pick.employee;
      remaining.splice(remaining.indexOf(emp), 1);

      const grounding = byEmployee[emp.id] || [];
      const turn = await executor.meetingTurn({
        employee: emp,
        grounding,
        context: {
          topic,
          rounds,
          round: r,
          roundTitle,
          roundGoal,
          participantList,
          managerQuestion: pick.question,
          convo: convo.contextFor(emp.name, { window: Math.max(participants.length, 4) }),
          priorSpeakers: convo.priorSpeakers().filter((n) => n !== emp.name),
        },
      });
      record(stats, turn.live);
      const added = convo.add({
        round: r + 1,
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

  emit({ type: 'synthesizing' });
  const transcript = convo.transcript();
  const minutes = engine.buildMinutes({ topic, participants, transcript });
  const report = await synthesizeMeetingReport({ topic, participants, transcript, minutes, grounding: flat });
  record(stats, report.live);

  return { transcript, minutes, report: report.text, grounding: flat, stats };
}

export function newStats() {
  const { model, provider } = executor.agentModel();
  return { total: 0, live: 0, model, provider };
}

export function record(stats, live) {
  stats.total++;
  if (live) stats.live++;
}
