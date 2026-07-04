// MeetingOrchestrator — a real, built-in, multi-round multi-agent meeting.
//
// This is the standalone runtime's answer to "meetings should be real
// orchestrated multi-agent conversations, not placeholders". For each round, and
// for each participant, it:
//   1. grounds the employee in *their own* retrieved knowledge (RAG),
//   2. injects the running conversation (ConversationState) so they respond to
//      what the others actually said,
//   3. runs a genuine agent turn via EmployeeAgentExecutor.
// Then a coordinating manager agent (ReportSynthesizer) writes the report from
// the REAL transcript. Everything happens in-process — no external Gateway.
import { ConversationState } from './ConversationState.js';
import * as executor from './EmployeeAgentExecutor.js';
import { synthesizeMeetingReport } from './ReportSynthesizer.js';
import { groundingFor } from '../storage/retrieval.js';
import * as engine from '../reasoning/engine.js';

const ROUND_TITLES = ['開場立場', '分析與風險', '決議與後續步驟', '深化與整合', '收斂與定案'];
const ROUND_GOALS = [
  '釐清成功標準、關鍵限制與你最關注的風險',
  '分析主要風險與取捨，回應其他成員的觀點',
  '收斂為具體決議、負責人與下一步',
  '深化尚未解決的爭點並提出整合方案',
  '對齊最終定案與檢查點',
];

/**
 * @param {object} req  { topic, participants, rounds }
 * @returns {Promise<{transcript, minutes, report, grounding, stats}>}
 */
export async function runMeeting({ topic, participants, rounds }) {
  const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');

  const convo = new ConversationState({ topic, participants });
  const stats = newStats();

  for (let r = 0; r < rounds; r++) {
    const roundTitle = ROUND_TITLES[r] || `第 ${r + 1} 輪`;
    const roundGoal = ROUND_GOALS[r] || '收斂結論';

    for (const emp of participants) {
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
          priorDigest: convo.digest(8),
          priorSpeakers: convo.priorSpeakers().filter((n) => n !== emp.name),
        },
      });
      record(stats, turn.live);
      convo.add({
        round: r + 1,
        roundTitle,
        speaker: emp.name,
        role: emp.roleTitle,
        speakerId: emp.id,
        text: turn.text,
        live: turn.live,
        citations: turn.citations,
      });
    }
  }

  const transcript = convo.transcript();
  const minutes = engine.buildMinutes({ topic, participants, transcript });
  const report = await synthesizeMeetingReport({ topic, participants, transcript, minutes });
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
