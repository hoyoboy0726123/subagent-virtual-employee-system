// ReportSynthesizer — the coordinating "manager" agent.
//
// After the employee agents have actually spoken, a separate coordinating agent
// (the manager / main agent) reads the REAL transcript and synthesizes the final
// artifact: a meeting report, or a goal collaboration output. Like the employee
// agents, this runs in-app via Google Gen AI with no external runtime; if the
// LLM is unavailable it falls back to assembling the artifact deterministically
// from the same real transcript, so output is never fabricated.
import { generate, llmEnabled } from '../reasoning/llm.js';
import * as engine from '../reasoning/engine.js';

const MANAGER_SYSTEM =
  '你是這場多代理協作的主管與協調者（main agent）。你會忠實統整旗下虛擬員工代理的真實發言，' +
  '不杜撰任何未提及的內容，全程以繁體中文輸出。';

/**
 * Synthesize a manager-level meeting report from the real transcript.
 * @returns {Promise<{text:string, live:boolean}>}
 */
export async function synthesizeMeetingReport({ topic, participants, transcript, minutes }) {
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');
  const body = transcript.map((t) => `第${t.round}輪 · ${t.speaker}（${t.role}）：${t.text}`).join('\n');
  const user = [
    '以下是各虛擬員工代理在會議中的真實逐字發言。請忠實統整為一份主管級會議報告。',
    '',
    `主題：${topic}`,
    `與會者：${participantList}`,
    '',
    '逐字紀錄：',
    body,
    '',
    '請以繁體中文輸出一份 Markdown 報告，只輸出報告本身，包含四個章節：',
    '「## 摘要」、「## 決議」、「## 行動項目」、「## 建議」。',
  ].join('\n');

  const live = await run(user);
  if (live) return { text: live, live: true };
  return { text: engine.buildReport({ topic, participants, minutes }), live: false };
}

/**
 * Synthesize a goal collaboration output from the assignees' real contributions.
 * @returns {Promise<{text:string, live:boolean}>}
 */
export async function synthesizeGoalOutput({ title, description, assignees, tasks }) {
  const body = tasks.map((t) => `${t.assignee}（${t.role}）：${t.approach}`).join('\n\n');
  const user = [
    '以下是各負責人（虛擬員工代理）針對目標提出的真實子任務與執行方法。請忠實整合為一份協作產出。',
    '',
    `目標：「${title}」`,
    description ? `說明：${description}` : '',
    '',
    '各負責人回覆：',
    body,
    '',
    '請以繁體中文輸出 Markdown，只輸出產出本身，包含四節：',
    '「## 計畫」、「## 各負責人子任務」、「## 整合」、「## 後續步驟」。',
  ].filter(Boolean).join('\n');

  const live = await run(user);
  if (live) return { text: live, live: true };
  return { text: engine.buildCollaborationOutput({ title, description, tasks, assignees }), live: false };
}

// One manager turn. Returns the trimmed text, or null to signal "fall back".
async function run(user) {
  if (!llmEnabled()) return null;
  const res = await generate({ system: MANAGER_SYSTEM, user, maxTokens: 1500, temperature: 0.6 });
  return res?.text?.trim() || null;
}
