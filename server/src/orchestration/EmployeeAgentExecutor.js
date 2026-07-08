// EmployeeAgentExecutor — runs ONE virtual employee as a distinct in-app agent.
//
// This is the heart of the standalone runtime. Each employee is executed as its
// own agent: a persona-scoped system instruction + the knowledge retrieved for
// *that* employee (RAG grounding) + the live conversation context, sent to
// Google Gen AI (`gemma-4-31b-it`) as a real model turn. Different employees get
// different personas and different grounding, so they genuinely diverge.
//
// Phase 8 focus — make the output read like real colleagues, not a template:
//   • the persona system prompt now conditions *voice and behaviour* (defend a
//     view, disagree with reasons, build on a named person) from the full
//     profile — role, personality, comms style, expertise, objectives, profile;
//   • the turn prompt is agent-aware (see ConversationState.contextFor): it knows
//     who this agent is answering, what it itself already argued, and what is
//     already settled — so callbacks feel earned, not formulaic;
//   • a per-round "stance" steers openings/challenges/commitments differently.
//
// No external runtime is required. If the LLM is not configured, or a turn fails
// (network/quota/empty), the executor degrades *per turn* to the deterministic
// engine and marks that turn `live: false` — so the orchestration is real either
// way, and the runtime metadata can report exactly how much ran live.
import { generateAgentic, llmEnabled, activeModelInfo } from '../reasoning/llm.js';
import { buildToolbox } from '../reasoning/tools.js';
import * as engine from '../reasoning/engine.js';
import { polishUtterance } from './output.js';
import { config } from '../config.js';

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const snippet = (text = '', n = 200) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

// A tiny deterministic hash so we can vary a couple of stylistic knobs *per
// employee* without randomness (keeps runs reproducible). Two employees on the
// same topic get a slightly different creative temperature, nudging distinct
// phrasing even before their personas diverge.
function seedOf(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// ---------------------------------------------------------------------------
// Persona system instruction — turns a bare model call into a specific employee
// agent with a recognisable voice. Grounding differs per employee, so this is
// where two agents on the same topic start to think (and sound) differently.
// ---------------------------------------------------------------------------
function personaSystem(emp, grounding) {
  const expertise = asList(emp.expertise);
  const expertiseLine = expertise.join('、') || '一般問題解決';
  const primary = expertise[0] || '你的專業領域';
  const knowledge = grounding.length
    ? grounding.map((h) => `- 《${h.documentTitle}》：${snippet(h.content)}`).join('\n')
    : '（目前沒有檢索到與此主題直接相關的個人知識，請完全依你的專業判斷作答，不要杜撰任何資料。）';

  const identity = [
    `【姓名】${emp.name}`,
    `【職稱】${emp.roleTitle}`,
    `【專長】${expertiseLine}`,
    emp.personality ? `【個性】${emp.personality}` : '',
    emp.communicationStyle ? `【溝通風格】${emp.communicationStyle}` : '',
    emp.objectives ? `【你在意的目標】${emp.objectives}` : '',
    emp.profile ? `【背景側寫】${snippet(emp.profile, 320)}` : '',
  ].filter(Boolean).join('\n');

  return [
    '你正在一個「虛擬員工系統」中，扮演一位真實的資深同事，和其他虛擬員工一起開會或協作。',
    '你不是在寫文章，而是在一場活生生的討論裡「說話」。全程使用繁體中文，只輸出你這一次的發言內容，',
    '不要加入旁白、標題、名字前綴、引號或任何 Markdown 標記。',
    '',
    identity,
    '',
    '【你的聲音與行為準則】',
    `- 用你的個性與溝通風格「說話」，而不是描述它們；讓別人光看語氣就知道這是 ${emp.name}。`,
    `- 你有立場。凡事先用${primary}的視角切入，給出明確主張，而不是四平八穩的場面話。`,
    '- 需要時就明確地表達不同意，並說出理由；也可以在別人的想法上往前推一步，指名是誰的點。',
    '- 具體：講得出取捨、數字、可交付物或驗收方式，而不是抽象原則。',
    '- 不要重複已經被講過或已達成共識的內容；把討論往前推。',
    '- 只在知識確實切題時才自然帶入其名稱；不相關就忽略，切勿杜撰。',
    '- 先查證、後發言：主題涉及最新資訊、市場現況、競品動態或你不確定的事實時，先使用你的工具查證，再開口。',
    '  未經查證就引用外部數字或「最新」動態，是嚴重錯誤；查了沒查到，就誠實說沒查到。',
    '',
    '【嚴禁的樣板語氣】',
    '- 不要用「從我的角度來看」「作為一名…」「總的來說」「首先／其次／最後」這類公式化開場或連接詞。',
    '- 不要空泛地附和（例如「我同意大家的看法」）而不補上你自己的實質內容。',
    '- 不要每次都用一樣的句型開頭；像真人一樣自然變化。',
    '- 不要把主題名稱整句重唸或照抄題目；能用「這件事／這條線／這個流程」承接時就不要回灌原文。',
    '',
    '【你被授權參考的個人知識】',
    knowledge,
  ].filter(Boolean).join('\n');
}

// Per-round behavioural stance. Openings stake a position; middle rounds push
// back and integrate; closing rounds commit to owned, concrete decisions.
function roundStance(round, rounds) {
  const isLast = round === rounds - 1;
  if (round === 0) {
    return '這是開場。清楚表態：你認為什麼才算成功、你最擔心的一個風險是什麼、以及你想守住的原則。不要面面俱到，挑你最在意的講。';
  }
  if (isLast) {
    return '這是收斂輪。把討論落地成具體決定：你願意負責哪一條工作線、交付什麼、用什麼標準驗收、下一個檢查點在何時。做出承諾，不要再開新問題。';
  }
  return '這是分析輪。針對前面的發言，明確地同意或反對某個人的某個具體論點並說明理由，補上別人漏掉的取捨或風險，讓結論更扎實。';
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
 * @param {object} opts.context       { topic, rounds, round (0-based), roundTitle, roundGoal, participantList, convo, priorSpeakers }
 * @returns {Promise<{text:string, live:boolean, citations:Array}>}
 */
export async function meetingTurn({ employee, grounding, context }) {
  const { topic, rounds, round, roundTitle, roundGoal, participantList, convo } = context;
  const view = convo || {};
  const stance = roundStance(round, rounds);

  // Trailing two-phase instruction: models weight the last lines most, so the
  // "check facts with your tools FIRST" step must come after the stance — and
  // topics that explicitly ask for verification make tool use mandatory.
  const speakClosing = [
    '發言前先判斷：這個主題、或你想主張的論點，是否需要最新外部事實或你知識庫的資料佐證？',
    '需要就先呼叫工具查證（可查多次），拿到結果後再發言；主題若明確提到「查證」「最新」「現況」，你必須至少查證一次才能發言。',
    '最後輸出約 3–5 句、口語、精煉的正式發言。',
  ].join('\n');

  let user;
  if (round === 0 && view.isFirstOverall) {
    user = [
      `這是一場關於「${topic}」的團隊會議，共 ${rounds} 輪。與會者：${participantList}。`,
      `現在是第 1 輪（${roundTitle}）。你是第一位發言者，為討論定調：${roundGoal}。`,
      stance,
      speakClosing,
    ].join('\n');
  } else {
    const lines = [`現在是第 ${round + 1} 輪（${roundTitle}），主題仍是「${topic}」。`];
    if (view.previousSpeaker) {
      lines.push(
        '',
        `你前一位發言的是 ${view.previousSpeaker.name}（${view.previousSpeaker.role}），他說：`,
        `「${view.previousSpeaker.text}」`,
        '請直接接著回應——認同就往前推進，有疑慮就具體點出，用得上就叫他的名字。',
      );
    }
    if (view.othersDigest && (!view.previousSpeaker || view.othersDigest.split('\n').length > 1)) {
      lines.push('', '這一輪稍早（及上一輪）其他人的重點：', view.othersDigest);
    }
    if (view.myLastPoint) {
      lines.push('', `你上一輪的立場是：「${view.myLastPoint}」。請延續它、不要自相矛盾，並在此基礎上推進。`);
    }
    if (context.managerDirective) {
      lines.push(
        '',
        `⚠ 你的主管（人類主持人）在討論中發話：「${context.managerDirective}」。`,
        '這是本場會議最高優先的指示——你的發言必須順著這個方向推進，先回應主管的點，再展開你的專業意見。',
      );
    }
    if (context.managerQuestion) {
      lines.push('', `主持會議的主管代理點名你發言，並追問：「${context.managerQuestion}」。請正面回答這個問題，不要迴避。`);
    }
    lines.push('', `本輪目標：${roundGoal}。`, stance, speakClosing);
    user = lines.join('\n');
  }

  const turn = await runOrFallback({
    employee,
    grounding,
    user,
    fallback: () => engine.speak(employee, topic, round, context.priorSpeakers || [], grounding),
  });
  return withCitations(turn, grounding);
}

/**
 * Run one employee's GOAL turn: their subtask + how they'll execute it.
 * @param {object} opts
 * @param {object} opts.employee
 * @param {Array}  opts.grounding
 * @param {object} opts.context   { title, description, others, otherProfiles }
 * @returns {Promise<{text:string, live:boolean, citations:Array}>}
 */
export async function goalTurn({ employee, grounding, context }) {
  const { title, description, others, otherProfiles } = context;
  const collaborators = otherProfiles && otherProfiles.length
    ? otherProfiles.map((o) => `- ${o.name}（${o.roleTitle}）：${asList(o.expertise).slice(0, 3).join('、') || '通用'}`).join('\n')
    : '（沒有其他負責人，這個目標由你端到端負責。）';

  const user = [
    `團隊目標：「${title}」`,
    description ? `目標說明：${description}` : '',
    '',
    '一起負責這個目標的還有：',
    collaborators,
    '',
    '請認領你最適合負責的那一塊，說清楚：',
    `1. 你負責的子任務（用你的${asList(employee.expertise)[0] || '專業'}切一塊別人不會重複的範圍）。`,
    '2. 你的具體做法與交付物。',
    '3. 你依賴誰、要跟誰交接（點名上面的負責人）。',
    '4. 驗收標準與你看到的最大風險。',
    '約 4–6 句，具體、口語，只輸出內容，不要條列編號、不要標題。',
  ].filter(Boolean).join('\n');

  const turn = await runOrFallback({
    employee,
    grounding,
    user,
    fallback: () => engine.goalApproach(employee, title, grounding),
  });
  return withCitations(turn, grounding);
}

/**
 * Run one employee's 1-ON-1 turn (Phase 19): a private conversation with the
 * MANAGER (the human). Unlimited turns — history is re-injected each call —
 * and the full toolbox is live, so「幫我查一下」actually triggers web/knowledge
 * search.
 * @param {object} opts
 * @param {object} opts.employee
 * @param {Array}  opts.grounding   chunks retrieved for the manager's message
 * @param {Array}  opts.history     prior turns [{who:'manager'|'employee', text}]
 * @param {string} opts.message     what the manager just said
 * @returns {Promise<{text:string, live:boolean, toolCalls:number, citations:Array}>}
 */
export async function oneOnOneTurn({ employee, grounding, history, message }) {
  const expertise = asList(employee.expertise);
  const knowledge = grounding.length
    ? grounding.map((h) => `- 《${h.documentTitle}》：${snippet(h.content)}`).join('\n')
    : '（這則訊息沒有直接命中你的知識庫，需要時請用工具查詢。）';

  const system = [
    `你是 ${employee.name}（${employee.roleTitle}），正在和你的主管進行一對一面談。`,
    employee.personality ? `你的個性：${employee.personality}。` : '',
    employee.communicationStyle ? `你的溝通風格：${employee.communicationStyle}。` : '',
    `你的專長：${expertise.join('、') || '一般問題解決'}。`,
    '',
    '【面談守則】',
    '- 誠實、具體、有立場：主管要的是專業判斷，不是奉承或場面話。',
    '- 主管要求查資料時，務必先用工具查證（web_search／search_knowledge）再回答，並說明出處。',
    '- 涉及最新資訊或你不確定的事實，先查再說；查不到就直說查不到。',
    '- 回覆長度跟著問題走：閒聊短答，要求分析或報告時可以完整展開。',
    '- 全程繁體中文，只輸出你要對主管說的話，不要旁白或名字前綴。',
    '',
    '【你被授權參考的個人知識】',
    knowledge,
  ].filter(Boolean).join('\n');

  const recent = (history || []).slice(-16);
  const lines = recent.map((t) => `${t.who === 'manager' ? '主管' : '你'}：${t.text}`);
  const user = [
    lines.length ? '【你們到目前為止的對話】' : '【這是本次面談的開場】',
    ...lines,
    '',
    `主管：${message}`,
    '',
    '請直接回應主管。',
  ].join('\n');

  if (llmEnabled()) {
    const agentCfg = employee.agentConfig || {};
    const toolbox = buildToolbox({ employee }); // one toolbox across attempts (remember-dedup)
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await generateAgentic({
        system,
        user,
        toolbox,
        // 1on1s legitimately produce DOCUMENTS (roadmaps, plans, reports) when
        // the manager asks — a small cap hard-clipped them mid-section. This is
        // per-request headroom, not a target: longer only costs when the model
        // actually writes more. Overridable via LLM_DOC_MAX_TOKENS.
        maxTokens: config.llm.output.document,
        temperature: Number.isFinite(agentCfg.temperature) ? agentCfg.temperature : 0.65,
        ...(agentCfg.model ? { model: agentCfg.model } : {}),
        ...(agentCfg.maxToolCalls ? { maxSteps: agentCfg.maxToolCalls } : {}),
      });
      const t = polishUtterance(res?.text || '');
      if (t) {
        return withCitations(
          { text: t, live: true, toolCalls: res.toolCalls, toolHits: toolbox.knowledgeHits(), webSources: toolbox.webSources() },
          grounding,
        );
      }
    }
  }
  // Offline: a persona-grounded deterministic answer, honestly non-live. The
  // engine round rotates with the conversation depth so consecutive replies in
  // one dialogue vary instead of repeating a single canned shape.
  const fallback = engine.speak(employee, message, (history?.length || 0) % 3, [], grounding);
  return withCitations(
    { text: polishUtterance(fallback), live: false, toolCalls: 0, toolHits: [], webSources: [] },
    grounding,
  );
}

// Merge the pre-injected grounding with whatever the agent looked up ITSELF —
// knowledge-base hits AND consulted web sources — so citations honestly cover
// everything the utterance drew on. Web sources carry `web: true` + url so the
// UI can render them as external references.
function withCitations(turn, grounding) {
  const citations = citationsFor(grounding);
  const seen = new Set(citations.map((c) => `${c.documentTitle}|${c.snippet}`));
  for (const h of turn.toolHits || []) {
    const k = `${h.documentTitle}|${h.snippet}`;
    if (seen.has(k) || citations.length >= 4) continue;
    seen.add(k);
    citations.push({ documentTitle: h.documentTitle, snippet: h.snippet });
  }
  for (const s of (turn.webSources || []).slice(0, 3)) {
    citations.push({ documentTitle: s.title || s.url, snippet: s.url, web: true });
  }
  const { toolHits, webSources, ...rest } = turn;
  return { ...rest, citations };
}

// Single live agentic turn (with tool use) plus one retry; deterministic
// fallback on failure. Returns { text, live, toolCalls, toolHits }. `live` is
// true only when the model actually answered.
//
// Per-agent configuration (Phase 15, employee.agentConfig) is applied here:
//   model        — this agent's model id (unset → global default)
//   temperature  — explicit sampling override; otherwise a per-employee seeded
//                  nudge (0.72–0.87) so distinct personas also phrase distinctly
//   maxToolCalls — this agent's per-turn tool budget
//   webSearch    — false forbids web_search for this agent (enforced in toolbox)
async function runOrFallback({ employee, grounding, user, fallback }) {
  if (llmEnabled()) {
    const agentCfg = employee.agentConfig || {};
    const system = personaSystem(employee, grounding);
    const temperature = Number.isFinite(agentCfg.temperature)
      ? agentCfg.temperature
      : 0.72 + ((seedOf(employee.id || employee.name) % 16) / 100); // 0.72–0.87
    // ONE toolbox across both attempts: if attempt 1 already wrote a `remember`
    // to the KB and then failed, a fresh toolbox on attempt 2 would re-run the
    // same remember and duplicate the memory. Reusing it also carries the
    // remember-dedup set forward (and accumulates honest citations).
    const toolbox = buildToolbox({ employee });
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await generateAgentic({
        system,
        user,
        toolbox,
        // Meeting speeches AND goal task turns. Conversational by prompt, but
        // 700 clipped substantive analyses mid-sentence — the ceiling is
        // headroom, not a target (LLM_TURN_MAX_TOKENS to override).
        maxTokens: config.llm.output.turn,
        temperature,
        ...(agentCfg.model ? { model: agentCfg.model } : {}),
        ...(agentCfg.maxToolCalls ? { maxSteps: agentCfg.maxToolCalls } : {}),
      });
      const t = polishUtterance(res?.text || '');
      if (t) {
        return {
          text: t,
          live: true,
          toolCalls: res.toolCalls,
          toolHits: toolbox.knowledgeHits(),
          webSources: toolbox.webSources(),
        };
      }
    }
  }
  return { text: polishUtterance(fallback()), live: false, toolCalls: 0, toolHits: [], webSources: [] };
}

// Honest model identity for runtime metadata (provider-aware, Phase 18).
export function agentModel() {
  const { model, provider } = activeModelInfo();
  return { model, provider };
}
