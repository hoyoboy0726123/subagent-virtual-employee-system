// EmployeeAgentExecutor — runs ONE virtual employee as a distinct in-app agent.
//
// This is the heart of the standalone runtime. Each employee is executed as its
// own agent: a persona-scoped system instruction + the knowledge retrieved for
// *that* employee (RAG grounding) + the live conversation context, sent to
// Google Gen AI (`gemma-4-31b-it`) as a real model turn. Different employees get
// different personas and different grounding, so they genuinely diverge.
//
// No external runtime is required. If the LLM is not configured, or a turn fails
// (network/quota/empty), the executor degrades *per turn* to the deterministic
// engine and marks that turn `live: false` — so the orchestration is real either
// way, and the runtime metadata can report exactly how much ran live.
import { generate, llmEnabled } from '../reasoning/llm.js';
import * as engine from '../reasoning/engine.js';
import { config } from '../config.js';

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const snippet = (text = '', n = 160) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

// Persona + retrieved-knowledge system instruction that turns a bare model call
// into a specific employee agent. Grounding differs per employee, so this is
// where two agents on the same topic start to think differently.
function personaSystem(emp, grounding) {
  const expertise = asList(emp.expertise).join('、') || '一般問題解決';
  const knowledge = grounding.length
    ? grounding.map((h) => `- 《${h.documentTitle}》：${snippet(h.content)}`).join('\n')
    : '（目前沒有檢索到與此主題直接相關的個人知識，請依你的專業判斷作答。）';
  return [
    '你正在一個「虛擬員工系統」中，扮演一位真實的虛擬員工代理，與其他虛擬員工一起協作。',
    '請嚴格維持以下人設，全程以繁體中文回覆，且只輸出你本人的發言內容，不要加入旁白、標題、名字前綴或 Markdown 標記。',
    '',
    `【姓名】${emp.name}`,
    `【職稱】${emp.roleTitle}`,
    `【專長】${expertise}`,
    emp.personality ? `【個性】${emp.personality}` : '',
    emp.communicationStyle ? `【溝通風格】${emp.communicationStyle}` : '',
    emp.objectives ? `【目標】${emp.objectives}` : '',
    '',
    '【你被授權參考的個人知識】',
    knowledge,
    '（若知識與當前問題相關，請自然地引用其名稱；若不相關則忽略，切勿杜撰。）',
  ].filter(Boolean).join('\n');
}

function citationsFor(grounding) {
  return grounding.slice(0, 2).map((h) => ({
    documentTitle: h.documentTitle,
    snippet: snippet(h.content, 60),
  }));
}

/**
 * Run one employee's MEETING turn.
 * @param {object} opts
 * @param {object} opts.employee
 * @param {Array}  opts.grounding     retrieved chunks scoped to this employee
 * @param {object} opts.context       { topic, rounds, round (0-based), roundTitle, roundGoal, participantList, priorDigest, priorSpeakers }
 * @returns {Promise<{text:string, live:boolean, citations:Array}>}
 */
export async function meetingTurn({ employee, grounding, context }) {
  const { topic, rounds, round, roundTitle, roundGoal, participantList, priorDigest } = context;
  const user = round === 0
    ? [
        `這是一場關於「${topic}」的團隊會議，共 ${rounds} 輪。與會者：${participantList}。`,
        `現在是第 1 輪（${roundTitle}）。請提出你的開場觀點：${roundGoal}。`,
        '精煉作答，約 3–5 句，只輸出你的發言。',
      ].join('\n')
    : [
        `現在是第 ${round + 1} 輪（${roundTitle}）。以下是目前為止的討論：`,
        priorDigest,
        '',
        `請延續討論、具體回應其他成員的觀點，並推進到：${roundGoal}。`,
        '精煉作答，約 3–5 句，只輸出你的發言。',
      ].join('\n');

  const text = await runOrFallback({
    employee,
    grounding,
    user,
    fallback: () => engine.speak(employee, topic, round, context.priorSpeakers || [], grounding),
  });
  return { ...text, citations: citationsFor(grounding) };
}

/**
 * Run one employee's GOAL turn: their subtask + how they'll execute it.
 * @param {object} opts
 * @param {object} opts.employee
 * @param {Array}  opts.grounding
 * @param {object} opts.context   { title, description, others }
 * @returns {Promise<{text:string, live:boolean, citations:Array}>}
 */
export async function goalTurn({ employee, grounding, context }) {
  const { title, description, others } = context;
  const user = [
    `團隊目標：「${title}」`,
    description ? `目標說明：${description}` : '',
    `其他負責人：${others}`,
    '',
    '請針對這個目標，說明「你負責的子任務」與「你的執行方法」：你會交付什麼、依賴哪些人、驗收標準為何。',
    '精煉作答，約 4–6 句，只輸出內容。',
  ].filter(Boolean).join('\n');

  const text = await runOrFallback({
    employee,
    grounding,
    user,
    fallback: () => engine.goalApproach(employee, title, grounding),
  });
  return { ...text, citations: citationsFor(grounding) };
}

// Single live model turn with one retry; deterministic fallback on failure.
// Returns { text, live }. `live` is true only when the model actually answered.
async function runOrFallback({ employee, grounding, user, fallback }) {
  if (llmEnabled()) {
    const system = personaSystem(employee, grounding);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await generate({ system, user, maxTokens: 700, temperature: 0.7 });
      const t = res?.text?.trim();
      if (t) return { text: t, live: true };
    }
  }
  return { text: fallback(), live: false };
}

// Honest model identity for runtime metadata.
export function agentModel() {
  return { model: config.llm.model, provider: config.llm.provider };
}
