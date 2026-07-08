// The deterministic "subagent" reasoning engine.
//
// Each virtual employee's contribution is generated from their persona (role,
// expertise, personality, comms style) PLUS retrieved knowledge chunks scoped to
// them (simple RAG). Every function here is pure and runs fully offline — this
// is the default runtime and the guaranteed fallback for the live/OpenClaw paths.
//
// All user-facing output is Traditional Chinese (繁體中文) to stay coherent with
// the UI. `groundingByEmployee` is a map of employeeId → array of retrieved
// chunks ({documentTitle, content, score, ...}); when empty the engine degrades
// gracefully to persona-only reasoning.

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || '成員';
}

const snippet = (text = '', n = 90) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

// ---------------------------------------------------------------------------
// 1. Profile / background generation
// ---------------------------------------------------------------------------
export function generateProfile(input) {
  const name = input.name || '新進員工';
  const role = input.roleTitle || '團隊成員';
  const expertise = asList(input.expertise);
  const personality = input.personality || '務實且善於協作';
  const style = input.communicationStyle || '清楚且精煉';
  const objectives = input.objectives || '協助團隊交付高品質的成果';

  const expertiseLine = expertise.length ? expertise.join('、') : '一般問題解決';

  return [
    `${name} 是團隊中的${role}。`,
    ``,
    `背景：${name} 在 ${expertiseLine} 方面擁有深厚經驗，以${personality}著稱，並習慣以證據與團隊目標作為決策依據。`,
    ``,
    `工作風格：${name} 以${style}的方式溝通。在討論中會聚焦於 ${expertise[0] || '核心問題'}，及早點出取捨，並推動具體的下一步。`,
    ``,
    `目標：${objectives}。`,
    ``,
    `行事原則：`,
    `- 每項建議都緊扣既定目標與已知限制。`,
    `- 先參考相關知識，再表達意見。`,
    `- 偏好小而可驗證的步驟，而非一次到位的大計畫。`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 2. Role ideation — manager describes what they want, we draft a full role
//    (keyword matching supports both English and Traditional Chinese input)
// ---------------------------------------------------------------------------
const ROLE_LIBRARY = [
  { match: /(front|ui|ux|design|react|css|前端|介面|設計)/i, roleTitle: '前端工程師', expertise: ['React', 'UI/UX', '無障礙設計', '設計系統'], personality: '注重細節且富同理心', style: '重視視覺與範例' },
  { match: /(back|api|server|database|infra|devops|cloud|後端|伺服器|資料庫|架構|維運)/i, roleTitle: '後端工程師', expertise: ['API', '資料庫', '可擴展性', '可靠性'], personality: '有系統且重視風險', style: '精確且結構化' },
  { match: /(\bdata\b|analytics|\bml\b|\bai\b|machine learning|\bmodel\b|scien|資料|數據|分析|機器學習|模型)/i, roleTitle: '資料科學家', expertise: ['統計', '機器學習', '實驗設計', '數據敘事'], personality: '好奇且嚴謹', style: '以證據為先並量化' },
  { match: /(product|pm|road|strategy|market fit|產品|策略|路線圖)/i, roleTitle: '產品經理', expertise: ['產品策略', '路線圖規劃', '使用者研究', '優先排序'], personality: '果斷且重視成效', style: '簡潔且具敘事性' },
  { match: /(market|growth|brand|content|seo|campaign|行銷|成長|品牌|內容|活動)/i, roleTitle: '行銷主管', expertise: ['市場定位', '內容', '成長迴圈', '分析'], personality: '有創意且以數據為本', style: '具說服力且精練' },
  { match: /(sales|revenue|account|customer success|deal|銷售|業務|營收|客戶成功)/i, roleTitle: '業務主管', expertise: ['管道管理', '談判', '需求探索', '關係經營'], personality: '有活力且堅持不懈', style: '溫暖且以成效為導向' },
  { match: /(finance|budget|account|cfo|cost|財務|預算|會計|成本)/i, roleTitle: '財務分析師', expertise: ['財務建模', '預算', '預測', '單位經濟'], personality: '謹慎且存疑', style: '以數字為先且保守' },
  { match: /(legal|compliance|risk|policy|privacy|法務|法律|合規|風險|隱私)/i, roleTitle: '法務與合規顧問', expertise: ['合約', '合規', '風險評估', '隱私'], personality: '一絲不苟且謹慎', style: '正式且謹慎保留' },
  { match: /(ops|operation|project|program|coordinat|營運|作業|專案|協調)/i, roleTitle: '營運經理', expertise: ['流程設計', '協調', '後勤', '執行'], personality: '有條理且可靠', style: '以檢查清單為本且清楚' },
  { match: /(research|analyst|insight|explore|研究|分析師|洞察)/i, roleTitle: '研究分析師', expertise: ['研究', '綜整', '競品分析', '報告撰寫'], personality: '徹底且客觀', style: '平衡且引用來源' },
];

export function ideateRole(description = '') {
  const desc = String(description);
  const hit = ROLE_LIBRARY.find((r) => r.match.test(desc)) || {
    roleTitle: '通用團隊成員',
    expertise: ['問題解決', '溝通', '協作'],
    personality: '靈活且務實',
    style: '清楚且精煉',
  };

  // Prefer an explicitly named person (English or Chinese) from the description.
  const nameGuess = (desc.match(/named?\s+([A-Z][a-z]+)/) || desc.match(/(?:叫做?|名為|名叫)\s*([一-龥]{2,4})/) || [])[1];
  const name = nameGuess || `${hit.roleTitle}人選`;

  const draft = {
    name,
    roleTitle: hit.roleTitle,
    expertise: hit.expertise,
    personality: hit.personality,
    communicationStyle: hit.style,
    objectives: `負責${hit.roleTitle}的職責，並透過${hit.expertise[0]}協助團隊達成目標。`,
  };
  draft.profile = generateProfile(draft);
  draft.rationale = `根據你的描述「${desc.slice(0, 120)}${desc.length > 120 ? '…' : ''}」草擬——比對到「${hit.roleTitle}」原型。儲存前可自由編輯任何欄位。`;
  return draft;
}

// ---------------------------------------------------------------------------
// 3. Meeting orchestration (retrieval-grounded)
// ---------------------------------------------------------------------------
// The offline path is the guaranteed baseline AND the per-turn fallback for the
// live runtime, so it must not read like a fill-in-the-blank template. We vary
// phrasing *deterministically* by a per-employee seed (reproducible, never
// random) and weave in each persona's expertise, personality and comms style, so
// two employees on the same topic sound recognisably different.

// Deterministic hash → pick, so variety is stable across runs (tests stay green).
function seed(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Negative-safe modulo pick: `s` may be produced by a signed shift and go
// negative, which would otherwise index past the array and yield `undefined`.
const pick = (arr, s) => arr[(((s % arr.length) + arr.length) % arr.length)];

// A short, persona-flavoured lens phrase ("以可靠性為重" etc.) derived from the
// employee's comms style / personality, used to colour their sentences.
function lens(emp) {
  const style = String(emp.communicationStyle || '');
  const persona = String(emp.personality || '');
  if (/數|量|evidence|data|證據|保守|number/i.test(style + persona)) return '用數據說話';
  if (/風險|謹慎|存疑|conservative|risk/i.test(style + persona)) return '先盯著風險';
  if (/視覺|範例|example|visual|使用者|user/i.test(style + persona)) return '從使用者體感出發';
  if (/敘事|story|說服|narrative/i.test(style + persona)) return '把來龍去脈講清楚';
  if (/結構|精確|checklist|清單|structured/i.test(style + persona)) return '把它拆成可執行的步驟';
  return '就事論事';
}

function voiceCue(emp) {
  const role = String(emp.roleTitle || '');
  const style = String(emp.communicationStyle || '');
  const persona = String(emp.personality || '');
  const bag = `${role} ${style} ${persona}`;
  if (/資料|分析|數據|統計|quant|evidence/i.test(bag)) return '先看指標';
  if (/設計|ui|ux|體驗|使用者|visual/i.test(bag)) return '先看使用者路徑';
  if (/後端|架構|可靠性|資料庫|infra/i.test(bag)) return '先看系統邊界';
  if (/產品|pm|策略|roadmap/i.test(bag)) return '先看取捨';
  if (/行銷|品牌|成長|內容/i.test(bag)) return '先看市場訊號';
  if (/法務|合規|風險|隱私/i.test(bag)) return '先看合規紅線';
  return '先把事情講清楚';
}

// `speak` is exported so the standalone orchestration layer can reuse it as the
// per-turn *deterministic fallback* when a live model turn is unavailable.
export function speak(emp, topic, round, priorSpeakers, hits) {
  const expertise = asList(emp.expertise);
  const focus = expertise[Math.min(round, Math.max(expertise.length - 1, 0))] || expertise[0] || '這個問題';
  const s = seed(`${emp.id || emp.name}#${round}`);
  const hit = hits.length ? hits[s % hits.length] : null;
  const cite = groundingClause(hit, s);
  const l = lens(emp);
  const voice = voiceCue(emp);
  const noun = topicNoun(topic);

  if (round === 0) {
    const style = openingStyle(emp, round, topic);
    const openers = [
      `${style.prefix}如果 ${focus} 一開始沒有講死，後面所有人都會各做各的。${voice}，我會先把驗收長相講清楚${cite}，這樣討論才有共同尺。${style.bridge}`,
      `${style.prefix}我先不談漂亮解法，先問 ${focus} 出事時誰來接、怎麼判定失手。${voice}，這塊如果現在不講透${cite}，整個${noun}很容易做到一半才發現假設錯了。`,
      `${style.prefix}${focus}對我來說不是配角，它決定這件事最後能不能穩定落地。${voice}，我想先把過關條件跟不能碰的邊界釘住${cite}。`,
      `${style.prefix}我會先抓 ${focus} 的判準，不然大家其實是在解不同版本的題目。${voice}，先把成功標準對齊${cite}，後面的分工才不會散掉。`,
      `${style.prefix}先別急著把方案鋪滿，${focus} 這條線要先看清楚。${voice}，我傾向把最容易翻車的地方先攤開${cite}，再決定要不要擴大。`,
    ];
    return stripTopicEcho(pick(openers, s), topic);
  }

  const ref = priorSpeakers.length
    ? firstName(pick(priorSpeakers, s >> 3))
    : '';
  if (round === 1) {
    const reacts = ref
      ? [
          `${ref}那個方向我接得上，但${focus}這塊我沒有那麼放心——`,
          `我想補一刀在${ref}剛剛那個判斷上：${focus}其實更容易失手——`,
          `順著${ref}的想法往下看，真正會卡住我們的還是${focus}——`,
          `我對${ref}的結論不算反對，只是${focus}這裡不能這麼快放過——`,
          `${ref}把大方向講到了，可是落到${focus}時，我覺得門檻還要再講死一點——`,
        ]
      : [`就${focus}這塊來說，`, `把鏡頭拉回${focus}：`, `我還是想先咬住${focus}——`];
    const bodies = [
      `${cite}${voice}，我${l}，所以提議先做一個小但量得到的版本，再用結果決定要不要擴。`,
      `${cite}${voice}，與其在抽象原則上兜圈，不如先替${focus}設一條明確門檻，過了再往下走。`,
      `${cite}${voice}，我會先把${focus}裡風險最高的那段拆出來驗證，先壓低不確定性再談全面鋪開。`,
      `${cite}${voice}，這裡最需要的不是更多口號，而是把${focus}變成一個可檢查、可被否證的假設。`,
    ];
    return stripTopicEcho(pick(reacts, s) + pick(bodies, s >> 5), topic);
  }

  // Closing / deepening rounds — commit to an owned workline with a real bar.
  const commits = [
    `這樣收斂吧：${focus}這條線我接，先交一版可 demo 的成果，驗收就看${criterionFor(focus)}。下個檢查點前，我會給大家一份能直接審的版本。`,
    `那我把話講實一點：${focus}由我負責，交付物要看得到、量得到——${criterionFor(focus)}。誰的產出要餵給我，我今天就把介面跟格式一起定下來。`,
    `我承諾把${focus}做到可驗收（${criterionFor(focus)}），檢查點前回報。若要上 demo，我會連同讓下一棒直接接手的說明一起補齊。`,
    `別再繞了，${focus}這塊我扛。先做出能跑、能檢查的第一版，標準就是${criterionFor(focus)}；如果中間卡在相依，我會第一時間拉人對齊。`,
  ];
  return stripTopicEcho(pick(commits, s), topic);
}

// A concrete-sounding acceptance bar keyed off the workline, so "驗收標準" isn't
// the same empty phrase every time.
function criterionFor(focus) {
  const bars = [
    `${focus}的關鍵指標達到目標值且可重現`,
    `第一版切片通過評審、無阻斷性缺陷`,
    `涵蓋核心情境的驗證全數通過`,
    `輸出可被下一棒直接接手、相依項目標示清楚`,
  ];
  return pick(bars, seed(focus));
}

function groundingClause(hit, s = 0) {
  if (!hit) return '';
  const source = `《${hit.documentTitle}》`;
  const line = snippet(hit.content, 42);
  const clauses = [
    `，而且 ${source} 有一段直接提醒「${line}」`,
    `；${source} 其實已經把這個風險寫得很白：「${line}」`,
    `，這點也跟 ${source} 提到的「${line}」對得上`,
    `，${source} 裡甚至直接寫到「${line}」`,
  ];
  return pick(clauses, s >> 2);
}

function escapeRegExp(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTopicEcho(text = '', topic = '') {
  let out = String(text || '').replace(/\s+/g, ' ').trim();
  const cleanTopic = String(topic || '').replace(/\s+/g, ' ').trim();
  if (!out || !cleanTopic || cleanTopic.length < 6) return out;

  const quoted = [`「${cleanTopic}」`, `『${cleanTopic}』`, `"${cleanTopic}"`, `'${cleanTopic}'`];
  for (const q of quoted) out = out.split(q).join('這件事');

  const topicRe = new RegExp(escapeRegExp(cleanTopic), 'g');
  const count = (out.match(topicRe) || []).length;
  if (count > 1) out = out.replace(topicRe, (_, idx) => (idx === 0 ? cleanTopic : '這件事'));

  out = out
    .replace(new RegExp(`^(就|對於|關於)${escapeRegExp(cleanTopic)}[，、：]?`), '')
    .replace(new RegExp(`^(這題|這件事|這個主題)就是${escapeRegExp(cleanTopic)}[，、：]?`), '$1')
    .replace(/這件事會被拖垮這件事/g, '整體會被拖垮')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}

function topicNoun(topic = '') {
  const clean = String(topic || '').trim();
  if (!clean) return '這件事';
  if (/流程|體驗|旅程/.test(clean)) return '流程';
  if (/平台|系統|工具|服務/.test(clean)) return '系統';
  if (/方案|計畫|專案/.test(clean)) return '方案';
  return '這件事';
}

function openingStyle(emp, round, topic = '') {
  const s = seed(`${emp.id || emp.name}:${round}:${topic}`);
  const styles = [
    { prefix: '我先挑明講，', bridge: '不然後面很容易越講越散。' },
    { prefix: '先抓最要命的那一段，', bridge: '這個先沒對齊，後面做再多都會歪掉。' },
    { prefix: '我想先把底線說清楚，', bridge: '底線沒守住，漂亮結論也站不住。' },
    { prefix: '如果只能先盯一個點，', bridge: '把這裡看住，其他討論才有意義。' },
    { prefix: '我不想把範圍講太滿，', bridge: '先把最核心的判準釘住比較實際。' },
  ];
  const bag = `${emp.roleTitle || ''} ${emp.communicationStyle || ''} ${emp.personality || ''} ${asList(emp.expertise).join(' ')}`;
  if (/資料|分析|統計|數據|evidence|metric/i.test(bag)) return styles[3];
  if (/設計|ui|ux|體驗|使用者|visual/i.test(bag)) return styles[2];
  if (/後端|架構|可靠性|資料庫|infra|api/i.test(bag)) return styles[1];
  if (/產品|pm|策略|roadmap/i.test(bag)) return styles[0];
  return pick(styles, s);
}

export function runMeeting({ topic, participants, rounds = 3, groundingByEmployee = {} }) {
  const transcript = [];
  const roundTitles = ['開場立場', '分析與風險', '決議與後續步驟', '深化與整合', '收斂與定案'];

  for (let r = 0; r < rounds; r++) {
    const priorSpeakers = [];
    for (const emp of participants) {
      const hits = groundingByEmployee[emp.id] || [];
      const text = speak(emp, topic, r, priorSpeakers, hits);
      transcript.push({
        round: r + 1,
        roundTitle: roundTitles[r] || `第 ${r + 1} 輪`,
        speaker: emp.name,
        role: emp.roleTitle,
        speakerId: emp.id,
        text,
        citations: hits.slice(0, 2).map((h) => ({ documentTitle: h.documentTitle, snippet: snippet(h.content, 60) })),
      });
      priorSpeakers.push(emp.name);
    }
  }

  const minutes = buildMinutes({ topic, participants, transcript });
  const report = buildReport({ topic, participants, minutes, transcript });
  return { transcript, minutes, report };
}

export function buildMinutes({ topic, participants, transcript }) {
  const attendees = participants.map((p) => `${p.name}（${p.roleTitle}）`);
  const noun = topicNoun(topic);
  // Key points come from the opening round (where positions are staked), trimmed.
  const keyPoints = transcript
    .filter((t) => t.round === 1)
    .map((t) => `- ${t.speaker}（${t.role}）：${snippet(stripTopicEcho(t.text, topic), 120)}`);

  const decisions = participants.map((p) => {
    const focus = asList(p.expertise)[0] || '指定';
    return `- ${p.name} 認領「${focus}」工作線，先交 demo 級第一版，交付標準為${criterionFor(focus)}。`;
  });

  const actionItems = participants.map((p) => {
    const focus = asList(p.expertise)[0] || '核心';
    return {
      owner: p.name,
      action: `${focus}切片先交第一版，附驗收依據與交接說明`,
      due: '下次檢查點',
    };
  });

  return {
    topic,
    attendees,
    agenda: [`對齊${noun}的成功標準與限制`, '盤點主要風險與取捨', '分工、驗收標準與檢查點'],
    keyPoints,
    decisions,
    actionItems,
    openQuestions: ['尚未決定的優先順序與資源配置', '跨負責人交接介面的細節'],
  };
}

export function buildReport({ topic, participants, minutes, transcript = [] }) {
  const names = participants.map((p) => firstName(p.name)).join('、');
  const lenses = participants
    .map((p) => `${firstName(p.name)}偏重${asList(p.expertise)[0] || '整體'}`)
    .join('、');
  const noun = topicNoun(topic);

  const bySpeaker = new Map();
  for (const turn of transcript || []) {
    if (!bySpeaker.has(turn.speaker)) bySpeaker.set(turn.speaker, []);
    bySpeaker.get(turn.speaker).push(turn);
  }

  const threads = Array.from(bySpeaker.entries()).slice(0, 4).map(([speaker, turns]) => {
    const role = turns[0]?.role || '成員';
    const opening = snippet(stripTopicEcho(turns[0]?.text || '', topic), 70);
    const close = turns.length > 1 ? snippet(stripTopicEcho(turns[turns.length - 1]?.text || '', topic), 70) : '';
    const arc = close && close !== opening ? `，後來收斂成 ${close}` : '';
    return `- **${speaker}**（${role}）一開始主張 ${opening}${arc}。`;
  });

  const risks = (minutes.openQuestions || []).length
    ? minutes.openQuestions.map((q) => `- ${q}`)
    : ['- 無重大未解問題。'];

  return [
    `# 會議報告：${topic}`,
    ``,
    `**與會者：** ${minutes.attendees.join('、')}`,
    `**建議展示重點：** 已收斂為可 demo 的第一版切片、負責人與檢查點。`,
    ``,
    `## 執行摘要`,
    `這場討論沒有停在觀點交換，而是很快把${noun}拉回「怎樣才算做成」與「哪些邊界不能退」兩件事。${participants.length} 位成員（${names}）分別從 ${lenses} 切入，先把分歧攤開，再收斂成可檢查的第一版切片。最後的共識很務實：先交出能 demo、能審查、也能讓下一棒直接接手的版本，再依驗收結果決定擴張節奏。`,
    ``,
    `## 討論脈絡`,
    ...(threads.length ? threads : ['- （本場以離線推理彙整，重點見下方決議與行動項目。）']),
    ``,
    `## 決議`,
    ...minutes.decisions,
    ``,
    `## 行動項目`,
    ...minutes.actionItems.map((a) => `- **${a.owner}** — ${a.action}（期限：${a.due}）`),
    ``,
    `## 風險與待解問題`,
    ...risks,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. Goal assignment & collaborative execution (retrieval-grounded)
// ---------------------------------------------------------------------------
export function executeGoal({ title, description, assignees, groundingByEmployee = {} }) {
  const tasks = assignees.map((emp, i) => {
    const hits = groundingByEmployee[emp.id] || [];
    const expertise = asList(emp.expertise);
    return {
      assignee: emp.name,
      assigneeId: emp.id,
      role: emp.roleTitle,
      subtask: goalSubtask(emp, title),
      approach: goalApproach(emp, title, hits),
      status: 'pending', // 待執行 until ▶ 執行交付 delivers it
      order: i + 1,
    };
  });

  const output = buildCollaborationOutput({ title, description, tasks, assignees });
  return { tasks, output };
}

// The subtask/approach for one assignee. Exported so the standalone orchestration
// layer can reuse them as the per-turn deterministic fallback for a goal.
export function goalSubtask(emp, title) {
  const expertise = asList(emp.expertise);
  return `主導「${title}」中${expertise[0] || '核心'}相關的部分`;
}

export function goalApproach(emp, title, hits = []) {
  const expertise = asList(emp.expertise);
  const focus = expertise[0] || '核心';
  const skills = expertise.slice(0, 2).join('與') || '我的專業';
  const s = seed(`${emp.id || emp.name}@${title}`);
  const l = lens(emp);
  const groundNote = hits.length ? `會先吃透《${hits[0].documentTitle}》裡的相關做法，` : '';
  const bars = criterionFor(focus);
  const voice = voiceCue(emp);
  const templates = [
    `我來扛${focus}這一塊。${groundNote}${voice}，我習慣${l}，會用${skills}把它做成可審查、可 demo 的交付物，驗收看${bars}。上游相依先跟相關負責人對齊介面，卡住的地方我會及早喊。`,
    `${focus}最吃我的專長，我認領。${groundNote}${voice}，我${l}，所以先切一個小而完整的版本、量得到成效再放大，交付標準是${bars}，相依項目我會清楚標給下一棒。`,
    `這塊的${focus}交給我。${groundNote}${voice}，我會${l}，先把風險最高的環節打通，產出讓其他負責人能直接接手的 demo 級成果，驗收依據為${bars}。`,
    `我負責${focus}。${groundNote}${voice}，做法上我傾向${l}：先用${skills}立一個能跑的骨架，再逐步補齊，過程中把介面與依賴攤開，驗收以${bars}為準。`,
  ];
  return pick(templates, s);
}

export function buildCollaborationOutput({ title, description, tasks, assignees }) {
  const lead = assignees.length ? firstName(assignees[0].name) : '';
  return [
    `# 協作產出：${title}`,
    ``,
    description ? `**目標：** ${description}\n` : '',
    `## 目標與成功標準`,
    `此目標依專長拆給 ${assignees.length} 位負責人，各認領一塊互不重疊、合起來可覆蓋目標的切片；做完的標準是每塊都通過各自驗收、且能在共用介面處順利合流。最少要能拿出一版可 demo、可審查、可接棒的整合成果。`,
    ``,
    `## 分工`,
    ...tasks.map((t) => `- **${t.assignee}**（${t.role}） — ${t.subtask}。${t.approach}`),
    ``,
    `## 相依與交接`,
    assignees.length > 1
      ? `各負責人的產出彼此為輸入，交接以「可被下一棒直接接手」為準；介面與資料格式在動工前先對齊，避免整合期才發現落差。`
      : `由單一負責人端到端推動，對外只需維持一個清楚的交付介面。`,
    ``,
    `## 整合計畫`,
    `各切片平行推進、於共用介面合流。${assignees.length > 1 ? `由 ${lead} 統籌交接節奏並裁決衝突。` : '由該負責人自行整合。'}`,
    ``,
    `## 里程碑與後續步驟`,
    `1. 各負責人確認自身切片的驗收標準與相依項目。`,
    `2. 交付可審查的初版並在共用介面整合。`,
    `3. 對照成功標準檢視，迭代到達標。`,
  ].filter(Boolean).join('\n');
}
