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
// `speak` is exported so the standalone orchestration layer can reuse it as the
// per-turn *deterministic fallback* when a live model turn is unavailable.
export function speak(emp, topic, round, priorSpeakers, hits) {
  const expertise = asList(emp.expertise);
  const focus = expertise[Math.min(round, expertise.length - 1)] || expertise[0] || '這個問題';
  const hit = hits.length ? hits[round % hits.length] : null;
  const grounded = hit
    ? `參考「${hit.documentTitle}」（「${snippet(hit.content)}」），`
    : '';

  if (round === 0) {
    return `從${emp.roleTitle}的角度來看，「${topic}」的關鍵問題在於它如何影響${focus}。${grounded}我會先釐清我們的成功標準與限制條件。`;
  }
  if (round === 1) {
    const react = priorSpeakers.length ? `延續${firstName(priorSpeakers[0])}的觀點，` : '';
    return `${react}我認為主要風險落在${focus}。${grounded}我的建議是先做出最小可行的原型並加以量測，再決定是否投入。`;
  }
  return `為「${topic}」做個總結：我會負責${focus}這條工作線，訂定明確的驗收標準，並回報結果。我們來確認各項負責人與檢查點的時間。`;
}

export function runMeeting({ topic, participants, rounds = 3, groundingByEmployee = {} }) {
  const transcript = [];
  const roundTitles = ['開場立場', '分析與風險', '決議與後續步驟'];

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
  const report = buildReport({ topic, participants, minutes });
  return { transcript, minutes, report };
}

export function buildMinutes({ topic, participants, transcript }) {
  const attendees = participants.map((p) => `${p.name}（${p.roleTitle}）`);
  const keyPoints = transcript.filter((t) => t.round <= 2).map((t) => `- ${t.speaker}：${t.text}`);
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

export function buildReport({ topic, participants, minutes }) {
  const names = participants.map((p) => firstName(p.name)).join('、');
  return [
    `# 會議報告：${topic}`,
    ``,
    `**與會者：** ${minutes.attendees.join('、')}`,
    ``,
    `## 摘要`,
    `${participants.length} 位團隊成員——${names}——共同討論「${topic}」。團隊在成功標準上達成共識，並從各自專業的角度盤點了主要風險，決定先以小規模、可量測的第一版切片著手，再擴大投入。`,
    ``,
    `## 決議`,
    ...minutes.decisions,
    ``,
    `## 行動項目`,
    ...minutes.actionItems.map((a) => `- **${a.owner}** — ${a.action}（期限：${a.due}）`),
    ``,
    `## 建議`,
    `先進行限時的原型驗證。於下次檢查點重新集合，檢視量測結果後，再決定是否投入更多資源。`,
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
  const groundNote = hits.length ? `，並參考「${hits[0].documentTitle}」等知識` : '';
  return `運用${expertise.slice(0, 2).join('與') || '領域專業'}${groundNote}。交付可供審閱的成果，並標示相依項目。`;
}

export function buildCollaborationOutput({ title, description, tasks, assignees }) {
  return [
    `# 協作產出：${title}`,
    ``,
    description ? `**目標：** ${description}\n` : '',
    `## 計畫`,
    `此目標依專業拆解給 ${assignees.length} 位員工，各自負責與其專長相符的切片：`,
    ``,
    ...tasks.map((t) => `- **${t.assignee}**（${t.role}） — ${t.subtask}。${t.approach}`),
    ``,
    `## 整合`,
    `各負責人平行交付各自的切片，再於共用的介面處整合。${assignees.length > 1 ? `由 ${firstName(assignees[0].name)} 負責協調交接並解決衝突。` : '由單一負責人端到端推動。'}`,
    ``,
    `## 後續步驟`,
    `1. 各負責人確認自身切片的驗收標準。`,
    `2. 交付初版並整合。`,
    `3. 對照目標進行檢視與迭代。`,
  ].filter(Boolean).join('\n');
}
