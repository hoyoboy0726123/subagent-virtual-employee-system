// Seed the SQLite store with example employees, knowledge documents (which get
// chunked + FTS-indexed), and one grounded demo meeting so the app is instantly
// explorable. Run: `npm run seed` (this RESETS the database).
import { resetDb } from './connection.js';
import { insertEmployee } from '../storage/employees.repo.js';
import { insertDocument } from '../storage/knowledge.repo.js';
import { insertMeeting } from '../storage/meetings.repo.js';
import { generateProfile } from '../reasoning/engine.js';
import { getRuntimeAdapter } from '../runtime/index.js';

export async function seed() {
  resetDb();

  const make = (data) => insertEmployee({ ...data, profile: generateProfile(data) });

  const aria = make({
    name: 'Aria Chen',
    roleTitle: '產品經理',
    personality: '果斷且重視成效',
    expertise: ['產品策略', '路線圖規劃', '使用者研究', '優先排序'],
    objectives: '在維持務實範疇的前提下，交付讓顧客喜愛的產品。',
    communicationStyle: '簡潔且具敘事性',
  });
  const marcus = make({
    name: 'Marcus Reid',
    roleTitle: '後端工程師',
    personality: '有系統且重視風險',
    expertise: ['API', '資料庫', '可擴展性', '可靠性'],
    objectives: '打造穩健、易維護且可擴展的後端。',
    communicationStyle: '精確且結構化',
  });
  const lena = make({
    name: 'Lena Ortiz',
    roleTitle: '前端工程師',
    personality: '注重細節且富同理心',
    expertise: ['React', 'UI/UX', '無障礙設計', '設計系統'],
    objectives: '交付令人愉悅且具無障礙性的介面。',
    communicationStyle: '重視視覺與範例',
  });
  const sam = make({
    name: 'Sam Patel',
    roleTitle: '資料科學家',
    personality: '好奇且嚴謹',
    expertise: ['統計', '機器學習', '實驗設計', '數據敘事'],
    objectives: '將數據轉化為團隊能夠信賴的決策。',
    communicationStyle: '以證據為先並量化',
  });

  const employees = [aria, marcus, lena, sam];

  // Knowledge documents — richer than the old one-line notes so chunking/retrieval
  // have something to work with.
  const docs = [
    [aria, '北極星指標', '我們的北極星指標是每週至少舉行一次會議的活躍團隊數。一切都以「啟用（activation）」為依歸。次要的護欄指標為第四週留存率與首次會議所需時間。我們不會為了註冊數等虛榮指標而最佳化。', ['策略']],
    [aria, '上線限制', 'MVP 必須能在本機執行，不需任何外部 API 金鑰，也不需原生建置步驟。範疇僅限核心流程：員工、知識庫、會議、目標。任何需要雲端基礎設施的項目在上線階段皆不在範圍內。', ['範疇']],
    [marcus, '持久化決策', '我們從 JSON 檔案儲存遷移到內建 node:sqlite 模組的 SQLite。這帶來交易、索引與 FTS5 全文檢索，且無需原生建置。已啟用 WAL 模式以支援並行讀取。外鍵會將員工的刪除層級式串連到其文件與知識片段。', ['後端', '架構決策']],
    [marcus, '檢索設計', '知識文件會被切分為約 480 字元、彼此重疊的片段，並索引於 FTS5 資料表中。檢索採用 BM25 排序，且可限定於一位或多位員工，這正是會議與目標能以正確人員知識為依據的關鍵。', ['後端', 'RAG']],
    [lena, '無障礙基準', '所有可互動元素都需有清楚可見的聚焦狀態與 ARIA 標籤。對比度須達 WCAG AA 標準。對話框必須鎖定焦點並可用 Esc 關閉。切勿僅以顏色來傳達狀態。', ['無障礙']],
    [sam, '實驗護欄', '指標變動未達 2 個標準誤前，絕不上線任何變更。務必在測試前先定義主要指標。偏好小而可量測的切片，而非一次到位的大改版，並事先登錄成功門檻。', ['統計']],
  ];
  for (const [emp, title, content, tags] of docs) {
    insertDocument(emp.id, { title, content, tags, source: 'note' });
  }

  // One grounded demo meeting through the default (standalone) runtime.
  const runtime = getRuntimeAdapter('standalone');
  const participants = [aria, marcus, lena];
  const topic = '虛擬員工系統的 MVP 範疇與持久化';
  const result = await runtime.runMeeting({ topic, participants, rounds: 3 });
  insertMeeting({
    topic,
    participantIds: participants.map((p) => p.id),
    participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    rounds: 3,
    transcript: result.transcript,
    minutes: result.minutes,
    report: result.report,
    grounding: result.grounding,
    runtime: result.runtime,
  });

  return { employees: employees.length, documents: docs.length, meetings: 1 };
}

// Run when invoked directly.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const counts = await seed();
  console.log(`已建立 ${counts.employees} 位員工、${counts.documents} 份知識文件、${counts.meetings} 場會議。`);
}
