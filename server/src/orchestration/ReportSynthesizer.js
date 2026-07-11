// ReportSynthesizer — the coordinating "manager" agent.
//
// After the employee agents have actually spoken, a separate coordinating agent
// (the manager / main agent) reads the REAL transcript and synthesizes the final
// artifact: a meeting report, or a goal collaboration output. Like the employee
// agents, this runs in-app via Google Gen AI with no external runtime; if the
// LLM is unavailable it falls back to assembling the artifact deterministically
// from the same real transcript, so output is never fabricated.
//
// Phase 8 sharpens the manager pass: it is briefed to write like a chief of
// staff — a crisp executive summary, decisions attributed to owners, action
// items with an owner + due + rationale, surfaced risks/open questions, and
// citations only where the retrieved knowledge genuinely bore on a point.
// De-duplication across turns is an explicit instruction, so the report reads
// tighter than the transcript.
import { generate, generateVision, geminiKeyPresent, llmEnabled } from '../reasoning/llm.js';
import * as engine from '../reasoning/engine.js';
import { polishArtifact } from './output.js';
import { config } from '../config.js';

const MANAGER_SYSTEM = [
  '你是這場多代理協作的主管兼幕僚長（main agent）。你的讀者是沒有參加這場討論的高階主管，',
  '他只想在兩分鐘內知道「談出了什麼、誰負責什麼、還有什麼沒解決」。',
  '你只根據旗下虛擬員工代理的真實發言來統整，不杜撰任何未提及的內容，也不無中生有數字或承諾。',
  '寫作要求：主管口吻、去除逐字稿的重複與寒暄、把發散的發言收斂成清楚的判斷。全程繁體中文。',
  '避免把主題原文、同一句前提或同一個結論反覆重寫；同義整併、只保留一次最清楚的表述。',
].join('');

const groundingBlock = (grounding = []) =>
  grounding.length
    ? ['', '（可供佐證的知識來源，只有在確實支撐某個論點時才在報告中自然引用其名稱）：',
       ...grounding.slice(0, 8).map((g) => `- 《${g.documentTitle}》：${String(g.content).replace(/\s+/g, ' ').slice(0, 160)}`)].join('\n')
    : '';

/**
 * Synthesize a manager-level meeting report from the real transcript.
 * @returns {Promise<{text:string, live:boolean}>}
 */
export async function synthesizeMeetingReport({ topic, participants, transcript, minutes, grounding = [], outputMode = 'full', agenda = '' }) {
  const participantList = participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、');
  const body = transcript.map((t) => `第${t.round}輪 · ${t.speaker}（${t.role}）：${t.text}`).join('\n');
  const agendaText = String(agenda || '').trim();
  const agendaBlock = agendaText ? ['', '本次會議的待討論事項（報告必須逐項回應）：', agendaText].join('\n') : '';
  // Conclusion mode: a decision-only report — no action items / owners / due
  // dates, just the team's final call. When an agenda exists it must answer
  // every item explicitly.
  const conclusionHeading = [
    '「## 最終結論／方案」：這是報告的重點。',
    `這一節的第一句話，必須直接、正面回答本次會議主題所提出的問題：「${topic}」——例如「決定開發 ⭕⭕ 系統」「採用 ⭕⭕ 方案」，用一句話把主題的答案講死，不能只談過程、子問題或原則卻不給出對主題本身的明確答案。`,
    agendaText
      ? '接著再逐一針對上面「待討論事項」的每一條，給出明確的最終方案或決定（可用小標或條列對應每一項）；若某項仍有分歧，明說採用哪個方案與理由。'
      : '接著把團隊收斂出的其餘決定或建議清楚寫成條列或短段落；若仍有分歧，明說採用哪個方案與理由。',
  ].join('\n');
  const sections = outputMode === 'conclusion'
    ? [
      '「## 執行摘要」：3–5 句，寫出會議的核心結論與最終方向，讓沒參加的人也讀得懂。',
      '「## 討論脈絡」：3–6 個要點，呈現主要論點如何交鋒與收斂（誰主張什麼、誰反對或補充），去除重複。',
      conclusionHeading,
      '「## 風險與待解問題」：條列尚未解決的爭點、風險或需要更多資訊之處；沒有就寫「無重大未解問題」。',
      '注意：這是「結論模式」——不要輸出「行動項目」「待辦」「負責人指派」「期限」這類章節或內容，只聚焦在針對每個待討論事項的最終方案。',
    ]
    : [
      '「## 執行摘要」：3–5 句，寫出會議的核心結論與方向，讓沒參加的人也讀得懂，不要流水帳。',
      '「## 討論脈絡」：3–6 個要點，呈現主要論點如何交鋒與收斂（誰主張什麼、誰提出反對或補充），去除重複。',
      agendaText ? '「## 決議」：逐一針對上面「待討論事項」的每一條標明結論與負責人；若某項未定案，明說「未定案」與卡在哪。' : '「## 決議」：條列已達成的決定，每條標明負責人；若某議題未定案，明說「未定案」與卡在哪。',
      '「## 行動項目」：每條為「- 負責人 — 具體行動（期限：…）」，行動要可執行、可驗收。',
      '「## 風險與待解問題」：條列尚未解決的爭點、風險或需要更多資訊之處；沒有就寫「無重大未解問題」。',
    ];
  const user = [
    '以下是各虛擬員工代理在這場會議中的真實逐字發言。請把它統整成一份主管級會議報告。',
    '',
    `主題：${topic}`,
    `與會者：${participantList}`,
    agendaBlock,
    groundingBlock(grounding),
    '',
    '逐字紀錄：',
    body,
    '',
    '請以繁體中文輸出一份 Markdown 報告，只輸出報告本身，嚴格使用下列章節與順序：',
    ...sections,
    '不要在報告裡加入這些以外的章節或前言。',
  ].filter(Boolean).join('\n');

  const live = await run(user);
  if (live) return { text: polishArtifact(live), live: true };
  return { text: polishArtifact(engine.buildReport({ topic, participants, minutes, transcript })), live: false };
}

/**
 * Synthesize a goal collaboration output from the assignees' real contributions.
 * @returns {Promise<{text:string, live:boolean}>}
 */
export async function synthesizeGoalOutput({ title, description, assignees, tasks, grounding = [] }) {
  const body = tasks.map((t) => `${t.assignee}（${t.role}）：${t.approach}`).join('\n\n');
  const user = [
    '以下是各負責人（虛擬員工代理）針對這個目標提出的真實子任務與執行方法。請把它整合成一份可執行的協作計畫。',
    '',
    `目標：「${title}」`,
    description ? `說明：${description}` : '',
    groundingBlock(grounding),
    '',
    '各負責人回覆：',
    body,
    '',
    '請以繁體中文輸出 Markdown，只輸出產出本身，嚴格使用下列章節與順序：',
    '「## 目標與成功標準」：2–4 句，寫清楚做完長什麼樣、怎麼算成功。',
    '「## 分工」：每位負責人一條「- 姓名（職稱）— 負責的切片與交付物」，確保切片彼此不重疊、合起來能覆蓋目標。',
    '「## 相依與交接」：點出負責人之間的依賴關係與交接介面（誰的產出是誰的輸入）。',
    '「## 整合計畫」：各切片如何合流、由誰協調衝突。',
    '「## 里程碑與後續步驟」：可檢查的階段與下一步，盡量標出負責人。',
    '不要加入這些以外的章節或前言。',
  ].filter(Boolean).join('\n');

  const live = await run(user);
  if (live) return { text: polishArtifact(live), live: true };
  return { text: polishArtifact(engine.buildCollaborationOutput({ title, description, tasks, assignees })), live: false };
}

/**
 * Turn a manager's messy paste (fragments, chat snippets, half-thoughts) into a
 * clean bulleted 待討論事項 list. Returns { text, live }. Falls back to a light
 * deterministic cleanup (split lines → bullets) when the LLM is unavailable.
 */
export async function organizeAgenda(raw, { topic, images = [] } = {}) {
  const source = String(raw || '').trim();
  const imgs = Array.isArray(images) ? images.filter((im) => im && im.data).slice(0, 4) : [];
  if (!source && !imgs.length) return { text: '', live: false };

  const instruction = [
    topic ? `會議主題：${topic}` : '',
    imgs.length
      ? '以下附上主管提供的圖片（可能是白板、筆記、截圖、聊天記錄、表格、文件或任何含資訊的影像，可能還夾帶一些文字）。請辨識圖片裡的文字與內容，整理成一份清楚、精簡、不重複的「待討論事項」清單：'
      : '以下是主管隨手貼上的雜亂文字與片段訊息。請整理成一份清楚、精簡、不重複的「待討論事項」清單：',
    source ? `\n${source}` : '',
    '',
    '輸出要求：只輸出 Markdown 無序清單（每行「- 」開頭），每條是一個明確、可被會議討論並收斂出結論的議題；',
    '合併語意重複者、刪掉無關塗鴉或寒暄、把模糊字句改寫成具體待決問題；不要加標題或前言，只輸出清單本身。全程繁體中文。',
  ].filter(Boolean).join('\n');

  // Image input → force Gemini (multimodal). No key → signal the caller to prompt.
  if (imgs.length) {
    if (!geminiKeyPresent()) return { text: '', live: false, needsGeminiKey: true };
    const res = await generateVision({ system: MANAGER_SYSTEM, user: instruction, images: imgs, maxTokens: config.llm.output.summary, temperature: 0.3 });
    if (res?.noKey) return { text: '', live: false, needsGeminiKey: true };
    const text = polishArtifact(res?.text?.trim() || '');
    if (text) return { text, live: true };
    // vision failed but we may still have pasted text — fall through to text path.
  }

  if (source && llmEnabled()) {
    const res = await generate({ system: MANAGER_SYSTEM, user: instruction, maxTokens: config.llm.output.summary, temperature: 0.3 });
    const text = polishArtifact(res?.text?.trim() || '');
    if (text) return { text, live: true };
  }
  // Deterministic fallback: each non-empty line becomes a bullet.
  const bullets = source.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.startsWith('- ') ? l : `- ${l.replace(/^[-*•]\s*/, '')}`));
  return { text: bullets.join('\n'), live: false };
}

// One manager turn. Returns the trimmed text, or null to signal "fall back".
// Document-tier output budget: a full manager report for a long meeting (many
// rounds × many participants) is a real deliverable — the ceiling is headroom
// (gemma-4 allows 32K out) and short reports simply stop early.
// Overridable via LLM_DOC_MAX_TOKENS.
async function run(user) {
  if (!llmEnabled()) return null;
  const res = await generate({ system: MANAGER_SYSTEM, user, maxTokens: config.llm.output.document, temperature: 0.55 });
  return polishArtifact(res?.text?.trim() || '') || null;
}
