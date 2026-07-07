// Service: manager 1-on-1 dialogues (Phase 19).
//
// The MANAGER (the human) talks to ONE employee agent with no turn limit; the
// employee answers in persona with the full toolbox live (ask it to 查資料 and
// it actually searches). The dialogue stays 'open' until the manager closes it
// — and only the manager decides whether the record is distilled into the
// employee's knowledge base.
import * as repo from '../storage/dialogues.repo.js';
import { getEmployee } from '../storage/employees.repo.js';
import { insertDocument } from '../storage/knowledge.repo.js';
import { search as retrievalSearch } from '../storage/retrieval.js';
import { oneOnOneTurn } from '../orchestration/EmployeeAgentExecutor.js';
import { generate, llmEnabled } from '../reasoning/llm.js';
import { badRequest, notFound } from '../util/http.js';

/** Open (or resume) the employee's 1-on-1. One open dialogue per employee. */
export function open(employeeId) {
  const emp = getEmployee(employeeId);
  if (!emp) throw notFound('找不到該員工');
  return repo.getOpenDialogue(employeeId) || repo.insertDialogue(employeeId);
}

export function get(dialogueId) {
  const d = repo.getDialogue(dialogueId);
  if (!d) throw notFound('找不到該面談');
  return d;
}

export function listForEmployee(employeeId) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  return repo.listDialogues(employeeId);
}

/** Manager says something; the employee agent replies (tools live). */
export async function say(dialogueId, text) {
  const d = get(dialogueId);
  if (d.status !== 'open') throw badRequest('這場面談已經結束。');
  const message = String(text || '').trim();
  if (!message) throw badRequest('請輸入要說的話');
  const emp = getEmployee(d.employeeId);
  if (!emp) throw notFound('與談員工已不存在');

  const grounding = retrievalSearch({ query: message, employeeIds: [emp.id], limit: 3 });
  const reply = await oneOnOneTurn({
    employee: emp,
    grounding,
    history: d.transcript,
    message,
  });

  const at = new Date().toISOString();
  const transcript = [
    ...d.transcript,
    { who: 'manager', text: message, at },
    {
      who: 'employee',
      text: reply.text,
      live: reply.live,
      toolCalls: reply.toolCalls || 0,
      citations: reply.citations || [],
      at: new Date().toISOString(),
    },
  ];
  return repo.updateDialogue(dialogueId, { transcript });
}

const DISTILL_SYSTEM = [
  '你是會談紀錄的整理者。把一場主管與員工的一對一面談整理成值得長期保存的知識庫文件。',
  '以繁體中文輸出 Markdown，章節：「## 主題」（一句話）、「## 結論與共識」、「## 主管的指示」、',
  '「## 員工的承諾與待辦」（可加期限）、「## 查證到的關鍵事實」（含出處，沒有就省略此節）。',
  '忠於對話內容，不杜撰；去除寒暄與重複。只輸出文件本身。',
].join('\n');

function fallbackRecord(emp, transcript) {
  const lines = transcript.map((t) => `- **${t.who === 'manager' ? '主管' : emp.name}**：${t.text}`);
  return `## 面談逐字紀錄\n\n${lines.join('\n')}`;
}

/**
 * Close the dialogue. `save: true` distills the record into the employee's
 * knowledge base (live summary; formatted transcript offline); `save: false`
 * just archives the dialogue.
 */
export async function close(dialogueId, { save } = {}) {
  const d = get(dialogueId);
  if (d.status !== 'open') throw badRequest('這場面談已經結束。');
  const emp = getEmployee(d.employeeId);

  let savedDocId = null;
  if (save && d.transcript.length) {
    let content = null;
    if (llmEnabled()) {
      const body = d.transcript.map((t) => `${t.who === 'manager' ? '主管' : emp.name}：${t.text}`).join('\n');
      const res = await generate({ system: DISTILL_SYSTEM, user: body, maxTokens: 2048, temperature: 0.3 });
      content = res?.text?.trim() || null;
    }
    if (!content) content = fallbackRecord(emp, d.transcript);

    const firstMsg = d.transcript.find((t) => t.who === 'manager')?.text || '面談';
    const doc = insertDocument(emp.id, {
      title: `1on1 紀錄：${firstMsg.slice(0, 40)}${firstMsg.length > 40 ? '…' : ''}`,
      content,
      source: 'dialogue',
      format: 'markdown',
      tags: ['1on1'],
      metadata: { dialogueId: d.id, turns: d.transcript.length, closedAt: new Date().toISOString() },
    });
    savedDocId = doc.id;
  }

  const updated = repo.updateDialogue(dialogueId, { status: 'closed', savedDocId });
  return { ...updated, saved: Boolean(savedDocId) };
}

export function remove(dialogueId) {
  if (!repo.deleteDialogue(dialogueId)) throw notFound('找不到該面談');
  return { ok: true };
}
