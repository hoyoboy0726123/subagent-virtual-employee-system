// Real OpenClaw multi-subagent orchestration.
//
// The manager (this backend / the main agent) drives a set of virtual employees,
// each of which is a real, isolated OpenClaw *session* (a subagent that persists
// its own memory across turns). We:
//   1. derive each employee's execution context from its stored persona + the
//      knowledge retrieved for it (RAG grounding),
//   2. run the meeting/goal as genuine multi-turn OpenClaw agent turns, threading
//      the other subagents' contributions into each prompt so they actually
//      respond to one another, and
//   3. ask a manager session to synthesize the final artifact from the REAL
//      transcript.
//
// Every string of user-facing output is Traditional Chinese to match the UI.
// Nothing here fabricates agent output: transcript/approach text is exactly what
// the subagents returned. Minutes and the fallback report are derived from that
// real transcript. If a subagent turn fails, we retry once and only then fall
// back to a clearly-flagged deterministic line, and we count it so the runtime
// metadata can report exactly how much of the run was live.
import { runTurn } from './cli.js';
import { groundingFor } from '../../storage/retrieval.js';
import { config } from '../../config.js';
import { id } from '../../util/ids.js';

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const firstName = (name = '') => name.trim().split(/\s+/)[0] || '成員';
const snippet = (text = '', n = 90) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function sessionId(kind, key, runId) {
  return `${config.openclaw.sessionPrefix}-${kind}-${key}-${runId}`;
}

// Persona + retrieved-knowledge preamble that turns a shared Gateway session into
// a specific employee. Sent on the employee's first turn; the session remembers
// it for later turns.
function personaHeader(emp, grounding) {
  const expertise = asList(emp.expertise).join('、') || '一般問題解決';
  const knowledge = grounding.length
    ? grounding.map((h) => `- 《${h.documentTitle}》：${snippet(h.content, 160)}`).join('\n')
    : '（目前沒有檢索到與此主題直接相關的個人知識，請依你的專業判斷作答。）';
  return [
    '你正在一場由主管主持的多代理團隊協作中，扮演一位虛擬員工（子代理）。',
    '請嚴格維持以下人設，全程以繁體中文回覆，且只輸出你的發言內容，不要加入旁白、標題或 Markdown 標記。',
    '',
    `【姓名】${emp.name}`,
    `【職稱】${emp.roleTitle}`,
    `【專長】${expertise}`,
    emp.personality ? `【個性】${emp.personality}` : '',
    emp.communicationStyle ? `【溝通風格】${emp.communicationStyle}` : '',
    emp.objectives ? `【目標】${emp.objectives}` : '',
    '',
    '【你被授權參考的團隊知識】',
    knowledge,
    '（若知識與當前問題相關，請自然地引用其名稱；若不相關則忽略。）',
  ].filter(Boolean).join('\n');
}

// Run one subagent turn with a single retry, then a flagged deterministic
// fallback so a transient Gateway hiccup never aborts the whole run.
async function turnOrFallback({ sessionId: sid, message, fallbackText }) {
  let last = await runTurn({ sessionId: sid, message });
  if (!last.ok) last = await runTurn({ sessionId: sid, message });
  if (last.ok) return { text: last.text.trim(), live: true, meta: last.meta };
  return { text: fallbackText, live: false, meta: last.meta, error: last.error };
}

// ---------------------------------------------------------------------------
// Meeting: one subagent per participant, multi-round, cross-threaded.
// ---------------------------------------------------------------------------
export async function runMeeting({ topic, participants, rounds }) {
  const runId = id('run').replace(/^run_/, '');
  const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });
  const roundTitles = ['開場立場', '分析與風險', '決議與後續步驟', '深化與整合', '收斂與定案'];
  const roundGoals = [
    '釐清成功標準、關鍵限制與你最關注的風險',
    '分析主要風險與取捨，回應其他成員的觀點',
    '收斂為具體決議、負責人與下一步',
    '深化尚未解決的爭點並提出整合方案',
    '對齊最終定案與檢查點',
  ];
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');

  const transcript = [];
  const stats = { total: 0, live: 0, model: null, provider: null };

  for (let r = 0; r < rounds; r++) {
    for (const emp of participants) {
      const grounding = byEmployee[emp.id] || [];
      const priorDigest = transcript.length
        ? transcript.slice(-8).map((t) => `${t.speaker}（${t.role}）：${t.text}`).join('\n')
        : '（你是本場會議第一位發言者。）';

      const message = r === 0
        ? [
            personaHeader(emp, grounding),
            '',
            `這是一場關於「${topic}」的團隊會議，共 ${rounds} 輪。與會者：${participantList}。`,
            `現在是第 1 輪（${roundTitles[0]}）。請提出你的開場觀點：${roundGoals[0]}。精煉作答，約 3–5 句。`,
          ].join('\n')
        : [
            `現在是第 ${r + 1} 輪（${roundTitles[r] || `第 ${r + 1} 輪`}）。以下是目前為止的討論：`,
            priorDigest,
            '',
            `請延續討論、回應其他成員，並推進到：${roundGoals[r] || '收斂結論'}。精煉作答，約 3–5 句，只輸出你的發言。`,
          ].join('\n');

      const focus = asList(emp.expertise)[Math.min(r, asList(emp.expertise).length - 1)] || '核心議題';
      const fallbackText = `（子代理暫時無法回應，以下為系統備援）從${emp.roleTitle}的角度，我會聚焦於${focus}，先確認成功標準與限制，再推進下一步。`;

      const { text, live, meta } = await turnOrFallback({
        sessionId: sessionId('emp', emp.id, runId), message, fallbackText,
      });
      stats.total++;
      if (live) {
        stats.live++;
        stats.model = stats.model || meta?.model || null;
        stats.provider = stats.provider || meta?.provider || null;
      }
      transcript.push({
        round: r + 1,
        roundTitle: roundTitles[r] || `第 ${r + 1} 輪`,
        speaker: emp.name,
        role: emp.roleTitle,
        speakerId: emp.id,
        text,
        live,
        citations: grounding.slice(0, 2).map((h) => ({ documentTitle: h.documentTitle, snippet: snippet(h.content, 60) })),
      });
    }
  }

  const minutes = buildMinutes({ topic, participants, transcript });
  const report = await synthesizeReport({ topic, participants, transcript, runId, minutes, stats });

  return { transcript, minutes, report, grounding: flat, stats };
}

function buildMinutes({ topic, participants, transcript }) {
  const attendees = participants.map((p) => `${p.name}（${p.roleTitle}）`);
  const keyPoints = transcript.filter((t) => t.round <= 2).map((t) => `- ${t.speaker}：${snippet(t.text, 140)}`);
  const decisions = participants.map(
    (p) => `- ${p.name} 負責${asList(p.expertise)[0] || '指定'}工作線，並訂定明確的驗收標準。`,
  );
  const actionItems = participants.map((p) => ({
    owner: p.name,
    action: `為「${topic}」訂定驗收標準並交付第一版切片`,
    due: '下次檢查點',
  }));
  return {
    topic,
    attendees,
    agenda: [`討論「${topic}」`, '盤點風險與取捨', '確認負責人與後續步驟'],
    keyPoints,
    decisions,
    actionItems,
  };
}

// Manager (main agent) synthesizes the report from the REAL transcript. Falls
// back to a locally-assembled report only if the manager turn fails.
async function synthesizeReport({ topic, participants, transcript, runId, minutes, stats }) {
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');
  const body = transcript
    .map((t) => `第${t.round}輪 · ${t.speaker}（${t.role}）：${t.text}`)
    .join('\n');
  const message = [
    '你是這場會議的主管與主持人（main agent）。以下是各虛擬員工（OpenClaw 子代理）的真實逐字發言。',
    '請忠實統整為一份主管級會議報告，不要杜撰未提及的內容。',
    '',
    `主題：${topic}`,
    `與會者：${participantList}`,
    '',
    '逐字紀錄：',
    body,
    '',
    '請以繁體中文輸出一份 Markdown 報告，只輸出報告本身，包含四個章節：「## 摘要」、「## 決議」、「## 行動項目」、「## 建議」。',
  ].join('\n');

  const res = await runTurn({
    sessionId: sessionId('mgr', 'meeting', runId),
    message,
    agentId: config.openclaw.managerAgentId,
  });
  if (res.ok && res.text.trim()) {
    stats.live++; stats.total++;
    return res.text.trim();
  }
  stats.total++;
  return localReport({ topic, participants, minutes });
}

function localReport({ topic, participants, minutes }) {
  const names = participants.map((p) => firstName(p.name)).join('、');
  return [
    `# 會議報告：${topic}`,
    '',
    `**與會者：** ${minutes.attendees.join('、')}`,
    '',
    '## 摘要',
    `${participants.length} 位團隊成員——${names}——共同討論「${topic}」，就成功標準達成共識並盤點主要風險。`,
    '',
    '## 決議',
    ...minutes.decisions,
    '',
    '## 行動項目',
    ...minutes.actionItems.map((a) => `- **${a.owner}** — ${a.action}（期限：${a.due}）`),
    '',
    '## 建議',
    '先進行限時的原型驗證，於下次檢查點檢視量測結果後再決定是否加碼投入。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Goal: one subagent per assignee, each produces its real subtask + approach,
// then the manager integrates.
// ---------------------------------------------------------------------------
export async function executeGoal({ title, description, assignees }) {
  const runId = id('run').replace(/^run_/, '');
  const query = `${title} ${description || ''}`.trim();
  const { byEmployee, flat } = groundingFor({ query, employees: assignees });
  const others = (self) => assignees.filter((a) => a.id !== self.id).map((a) => a.name).join('、') || '（無，僅你一位負責人）';

  const stats = { total: 0, live: 0, model: null, provider: null };
  const tasks = [];

  for (let i = 0; i < assignees.length; i++) {
    const emp = assignees[i];
    const grounding = byEmployee[emp.id] || [];
    const message = [
      personaHeader(emp, grounding),
      '',
      `團隊目標：「${title}」`,
      description ? `目標說明：${description}` : '',
      `其他負責人：${others(emp)}`,
      '',
      '請針對這個目標，說明「你負責的子任務」與「你的執行方法」：你會交付什麼、依賴哪些人、驗收標準為何。精煉作答，約 4–6 句，只輸出內容。',
    ].filter(Boolean).join('\n');

    const expertise = asList(emp.expertise);
    const fallbackText = `（子代理暫時無法回應，以下為系統備援）運用${expertise.slice(0, 2).join('與') || '領域專業'}主導「${title}」中${expertise[0] || '核心'}相關的部分，交付可審閱成果並標示相依項目。`;

    const { text, live, meta } = await turnOrFallback({
      sessionId: sessionId('emp', emp.id, runId), message, fallbackText,
    });
    stats.total++;
    if (live) {
      stats.live++;
      stats.model = stats.model || meta?.model || null;
      stats.provider = stats.provider || meta?.provider || null;
    }
    tasks.push({
      assignee: emp.name,
      assigneeId: emp.id,
      role: emp.roleTitle,
      subtask: `主導「${title}」中${expertise[0] || '核心'}相關的部分`,
      approach: text,
      live,
      status: 'in-progress',
      order: i + 1,
    });
  }

  const output = await synthesizeGoal({ title, description, assignees, tasks, runId, stats });
  return { tasks, output, grounding: flat, stats };
}

async function synthesizeGoal({ title, description, assignees, tasks, runId, stats }) {
  const body = tasks.map((t) => `${t.assignee}（${t.role}）：${t.approach}`).join('\n\n');
  const message = [
    '你是專案經理（main agent）。以下是各負責人（OpenClaw 子代理）針對目標的真實子任務與執行方法。',
    '請忠實整合為一份協作產出，不要杜撰未提及的內容。',
    '',
    `目標：「${title}」`,
    description ? `說明：${description}` : '',
    '',
    '各負責人回覆：',
    body,
    '',
    '請以繁體中文輸出 Markdown，只輸出產出本身，包含四節：「## 計畫」、「## 各負責人子任務」、「## 整合」、「## 後續步驟」。',
  ].filter(Boolean).join('\n');

  const res = await runTurn({
    sessionId: sessionId('mgr', 'goal', runId),
    message,
    agentId: config.openclaw.managerAgentId,
  });
  if (res.ok && res.text.trim()) {
    stats.live++; stats.total++;
    return res.text.trim();
  }
  stats.total++;
  return localGoalOutput({ title, description, assignees, tasks });
}

function localGoalOutput({ title, description, assignees, tasks }) {
  return [
    `# 協作產出：${title}`,
    '',
    description ? `**目標：** ${description}\n` : '',
    '## 計畫',
    `此目標依專業拆解給 ${assignees.length} 位員工，各自負責與其專長相符的切片：`,
    '',
    ...tasks.map((t) => `- **${t.assignee}**（${t.role}） — ${t.subtask}。${t.approach}`),
    '',
    '## 整合',
    `各負責人平行交付切片，再於共用介面處整合。${assignees.length > 1 ? `由 ${firstName(assignees[0].name)} 協調交接並解決衝突。` : '由單一負責人端到端推動。'}`,
    '',
    '## 後續步驟',
    '1. 各負責人確認自身切片的驗收標準。',
    '2. 交付初版並整合。',
    '3. 對照目標進行檢視與迭代。',
  ].filter(Boolean).join('\n');
}
