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

// `speak` is exported so the standalone orchestration layer can reuse it as the
// per-turn *deterministic fallback* when a live model turn is unavailable.
export function speak(emp, topic, round, priorSpeakers, hits) {
  const expertise = asList(emp.expertise);
  const focus = expertise[Math.min(round, Math.max(expertise.length - 1, 0))] || expertise[0] || '這個問題';
  const s = seed(`${emp.id || emp.name}#${round}`);
  const hit = hits.length ? hits[s % hits.length] : null;
  const cite = hit ? `（我看過《${hit.documentTitle}》，裡面提到「${snippet(hit.content)}」）` : '';
  const l = lens(emp);

  if (round === 0) {
    const openers = [
      `這題對我來說，成敗就看${focus}守不守得住。${cite}我習慣${l}，所以想先把「怎樣才算成功」定義清楚，不然後面會各說各話。`,
      `先講我最擔心的一點：${focus}一旦沒顧好，整個「${topic}」會被拖垮。${cite}我傾向${l}，把限制條件先攤開再談做法。`,
      `我在意的是${focus}。${cite}比起一次做滿，我更想先釐清成功標準跟不能碰的紅線——這也是我${l}的習慣。`,
      `站在${emp.roleTitle}的位置，我會盯住${focus}。${cite}我${l}，建議先對齊目標與限制，別急著跳進解法。`,
      `讓我起個頭：「${topic}」真正的槓桿在${focus}。${cite}我一向${l}，想先確認我們對「成功」的定義是不是同一個。`,
    ];
    return pick(openers, s);
  }

  const ref = priorSpeakers.length
    ? firstName(pick(priorSpeakers, s >> 3))
    : '';
  if (round === 1) {
    const reacts = ref
      ? [
          `${ref}講的方向我大致同意，但${focus}這塊我沒那麼樂觀——`,
          `我想補一個${ref}沒點到的取捨：`,
          `順著${ref}的點往下想，真正的變數其實在${focus}——`,
          `我對${ref}的判斷有點保留，至少在${focus}上——`,
        ]
      : [`就${focus}來說，`, `把焦點拉回${focus}：`, `我最擔心的還是${focus}——`];
    const bodies = [
      `${cite}我${l}，提議先做一個最小、可量測的版本，用結果決定要不要加碼。`,
      `${cite}與其僵在這，不如替${focus}設一個明確門檻，過了才往下走。`,
      `${cite}我會先鎖定${focus}裡風險最高的一段驗證，把不確定性壓下來再擴大。`,
    ];
    return pick(reacts, s) + pick(bodies, s >> 5);
  }

  // Closing / deepening rounds — commit to an owned workline with a real bar.
  const commits = [
    `結論我來收：${focus}這條線我認領，驗收標準是${criterionFor(focus)}，下個檢查點前給你們可審的版本。`,
    `那就這樣定：我負責${focus}，交付物看得到、量得到——${criterionFor(focus)}。誰的產出是我的輸入，我們先對一下介面。`,
    `我承諾把${focus}做到可驗收（${criterionFor(focus)}），並在檢查點回報。剩下沒定的，我們現在就把負責人補上。`,
  ];
  return pick(commits, s);
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
  // Key points come from the opening round (where positions are staked), trimmed.
  const keyPoints = transcript
    .filter((t) => t.round === 1)
    .map((t) => `- ${t.speaker}（${t.role}）：${snippet(t.text, 120)}`);

  const decisions = participants.map((p) => {
    const focus = asList(p.expertise)[0] || '指定';
    return `- ${p.name} 認領「${focus}」工作線，交付標準為${criterionFor(focus)}。`;
  });

  const actionItems = participants.map((p) => {
    const focus = asList(p.expertise)[0] || '核心';
    return {
      owner: p.name,
      action: `就「${topic}」的${focus}切片交付第一版並附驗收依據`,
      due: '下次檢查點',
    };
  });

  return {
    topic,
    attendees,
    agenda: [`對齊「${topic}」的成功標準與限制`, '盤點主要風險與取捨', '分工、驗收標準與檢查點'],
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

  const threads = (transcript.length ? transcript : [])
    .filter((t) => t.round <= 2)
    .slice(0, 6)
    .map((t) => `- **${t.speaker}**（${t.role}）：${snippet(t.text, 110)}`);

  return [
    `# 會議報告：${topic}`,
    ``,
    `**與會者：** ${minutes.attendees.join('、')}`,
    ``,
    `## 執行摘要`,
    `${participants.length} 位成員（${names}）就「${topic}」交換了立場——${lenses}。討論先對齊成功標準與限制，再逐一盤點風險與取捨，最後把工作切成各有負責人、各有驗收標準的小塊，決定以可量測的第一版切片先行、再依數據擴大投入。`,
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
    ...(minutes.openQuestions || []).map((q) => `- ${q}`),
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
      status: 'in-progress',
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
  const templates = [
    `我來扛${focus}這一塊。${groundNote}我習慣${l}，會用${skills}把它做成可審查的交付物，驗收看${bars}。上游相依先跟相關負責人對齊介面，卡住的地方我會及早喊。`,
    `${focus}最吃我的專長，我認領。${groundNote}我${l}，所以先切一個小而完整的版本、量得到成效再放大，交付標準是${bars}，相依項目我會清楚標給下一棒。`,
    `這塊的${focus}交給我。${groundNote}我會${l}，先把風險最高的環節打通，產出讓其他負責人能直接接手，驗收依據為${bars}。`,
    `我負責${focus}。${groundNote}做法上我傾向${l}：先用${skills}立一個能跑的骨架，再逐步補齊，過程中把介面與依賴攤開，驗收以${bars}為準。`,
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
    `此目標依專長拆給 ${assignees.length} 位負責人，各認領一塊互不重疊、合起來可覆蓋目標的切片；做完的標準是每塊都通過各自驗收、且能在共用介面處順利合流。`,
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
