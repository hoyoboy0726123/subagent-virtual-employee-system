// Service: autonomous research (Phase 14).
//
// "讓 agent 自己去找資料回來" — an employee agent, armed with the web_search
// tool (Tavily advanced depth), researches a topic ON ITS OWN: it decides what
// to query, runs multiple searches, and writes a Traditional Chinese
// investigation report with explicit source attribution. The report is stored
// as PENDING and shown to the manager (the user); approval ingests it into that
// employee's personal knowledge base through the same document/chunk/FTS path
// as an uploaded file, rejection archives it. Nothing enters the knowledge base
// without the manager's sign-off.
import { generateAgentic, llmEnabled } from '../reasoning/llm.js';
import { buildToolbox, webSearchConfigured, webSearchEnabled } from '../reasoning/tools.js';
import { normalizeTraditional } from '../orchestration/output.js';
import * as repo from '../storage/research.repo.js';
import { insertDocument } from '../storage/knowledge.repo.js';
import { getEmployee } from '../storage/employees.repo.js';
import { badRequest, notFound } from '../util/http.js';
import { config } from '../config.js';

function requireWebResearch() {
  if (!llmEnabled()) {
    throw badRequest('自主研究需要即時模型：請先設定 GEMINI_API_KEY。');
  }
  if (!webSearchConfigured()) {
    throw badRequest('自主研究需要網路搜尋：請先設定 TAVILY_API_KEY（或 WEB_SEARCH_API_KEY）。');
  }
  if (!webSearchEnabled()) {
    throw badRequest('網路搜尋開關未開啟：請在頁面上方打開「網路搜尋」。');
  }
}

const researchSystem = (emp) => [
  `你是 ${emp.name}（${emp.roleTitle}），正在替你的主管執行一項網路調查任務。`,
  '你必須先用 web_search 工具做足功課——從不同角度查詢（建議 3 次以上，中英文關鍵字都試），再動筆。',
  '查證完成後，輸出一份繁體中文的 Markdown 調查報告，嚴格使用以下章節：',
  '「## 摘要」：3–5 句，讓沒時間的人看完就懂。',
  '「## 重點發現」：條列 4–8 點，每一點都要具體（數字、日期、名稱），並在句尾以（來源：網站或機構名）標注出處。',
  '「## 詳細說明」：把發現展開成有脈絡的段落，引用外部資料時同樣標明出處。',
  '「## 資料來源」：條列你實際引用的來源，格式「- 標題 — URL」。',
  '「## 給主管的建議」：2–4 點，站在你的職位視角。',
  '規則：只能根據搜尋結果寫，不可杜撰；沒查到的就明說查不到；除了報告本身，不要輸出任何其他文字。',
].join('\n');

/**
 * Run one autonomous research task for an employee. Returns the stored PENDING
 * report record (the manager reviews it before it can enter the knowledge base).
 */
export async function runResearch(employeeId, topic) {
  const emp = getEmployee(employeeId);
  if (!emp) throw notFound('找不到該員工');
  const subject = String(topic || '').trim();
  if (!subject) throw badRequest('請輸入要調查的主題');
  requireWebResearch();

  const toolbox = buildToolbox({ employee: emp, research: true });
  const res = await generateAgentic({
    system: researchSystem(emp),
    user: `調查主題：「${subject}」。請開始查證並完成報告。`,
    toolbox,
    maxTokens: 4096,
    temperature: 0.5,
    maxSteps: config.tools.researchMaxCalls,
  });

  if (!res?.text) {
    throw badRequest('研究代理未能完成報告（模型無回應），請稍後再試。');
  }
  const webQueries = toolbox.trace.filter((t) => t.tool === 'web_search').map((t) => t.args?.query || '');
  if (!webQueries.length) {
    throw badRequest('研究代理沒有實際執行網路搜尋，報告不可信，已捨棄。請重試或換個主題敘述。');
  }

  return repo.insertReport({
    employeeId,
    topic: subject,
    report: normalizeTraditional(res.text), // enforce TC before it can enter the KB
    sources: toolbox.webSources(),
    queries: webQueries,
    live: true,
  });
}

export function listResearch(employeeId) {
  if (employeeId && !getEmployee(employeeId)) throw notFound('找不到該員工');
  return repo.listReports(employeeId);
}

/** Manager approves: the report becomes a knowledge document for that employee. */
export function approveResearch(reportId) {
  const report = repo.getReport(reportId);
  if (!report) throw notFound('找不到該研究報告');
  if (report.status !== 'pending') throw badRequest('此報告已完成審核');

  const doc = insertDocument(report.employeeId, {
    title: `調查報告：${report.topic}`,
    content: report.report,
    source: 'research',
    format: 'markdown',
    tags: ['research'],
    metadata: {
      researchReportId: report.id,
      webSources: report.sources,
      webQueries: report.queries,
      approvedAt: new Date().toISOString(),
    },
  });
  return { report: repo.reviewReport(reportId, 'approved', doc.id), document: doc };
}

/** Manager rejects: archived, never enters the knowledge base. */
export function rejectResearch(reportId) {
  const report = repo.getReport(reportId);
  if (!report) throw notFound('找不到該研究報告');
  if (report.status !== 'pending') throw badRequest('此報告已完成審核');
  return { report: repo.reviewReport(reportId, 'rejected') };
}

export function removeResearch(reportId) {
  if (!repo.deleteReport(reportId)) throw notFound('找不到該研究報告');
  return { ok: true };
}
