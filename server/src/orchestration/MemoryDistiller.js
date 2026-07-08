// MemoryDistiller (Phase 15) — cross-meeting persistent memory.
//
// Until now an employee forgot everything the moment a meeting ended
// (ConversationState is per-run). After each meeting this module distills, for
// EACH participant, a compact first-person memory — their stance, what they
// committed to, and the team decisions that bind them — and writes it into that
// employee's own knowledge base (source: 'memory'). Because memories go through
// the same document → chunk → FTS path as any other knowledge:
//   • the next meeting's grounding pass can surface them by topic, and
//   • the agent itself can pull them mid-turn via search_knowledge.
// That is what makes "上週開過的會" something an employee actually remembers.
//
// Distillation is ONE manager-model call for the whole meeting (JSON per
// participant), with a deterministic per-participant fallback (their opening
// stance + their final commitment + the report) so memory works offline too.
// MEETING_MEMORY_DISABLE=1 turns the whole feature off.
import { generate, llmEnabled } from '../reasoning/llm.js';
import { config } from '../config.js';
import { insertDocument, findMemoryDocument } from '../storage/knowledge.repo.js';
import { scheduleEmbedding } from '../reasoning/indexer.js';
import { scheduleConsolidation } from './MemoryConsolidator.js';
import { normalizeTraditional } from './output.js';

const disabled = () => /^(1|true|yes|on)$/i.test(process.env.MEETING_MEMORY_DISABLE || '');

const DISTILL_SYSTEM = [
  '你是會議記憶的整理者。針對每位與會者，站在「那位員工自己」的視角，把這場會議濃縮成他日後需要記得的內容：',
  '他自己的立場與主張、他承諾負責的事項（含期限/驗收方式，若有）、以及對他有約束力的團隊決議。',
  '每人 2–4 句、第一人稱（「我」）、具體、繁體中文。',
  '只輸出 JSON 陣列，格式：[{"name":"員工姓名","memory":"..."}]，不要任何其他文字或 Markdown 圍欄。',
].join('\n');

function parseDistillation(text, participants) {
  try {
    const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return null;
    const byName = new Map(arr
      .filter((x) => x && typeof x.name === 'string' && typeof x.memory === 'string' && x.memory.trim())
      .map((x) => [x.name.trim(), x.memory.trim()]));
    // Valid only if it covers at least one actual participant.
    return participants.some((p) => byName.has(p.name)) ? byName : null;
  } catch {
    return null;
  }
}

// Deterministic fallback: the employee's own opening stance + final commitment,
// plus a pointer to the meeting's decisions. Built purely from the transcript.
function fallbackMemory(participant, topic, transcript) {
  const mine = transcript.filter((t) => t.speakerId === participant.id || t.speaker === participant.name);
  if (!mine.length) return null;
  const opening = mine[0].text;
  const closing = mine[mine.length - 1].text;
  const parts = [
    `在「${topic}」會議中，我的立場是：${opening}`,
    mine.length > 1 ? `我最後承諾：${closing}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * Distill and persist per-participant memories for a finished meeting.
 * Returns [{employeeId, documentId, live}] (empty when the feature is off).
 */
export async function distillMeetingMemories({ meetingId, topic, participants, transcript, report }) {
  if (disabled() || !participants?.length || !transcript?.length) return [];

  let byName = null;
  let live = false;
  if (llmEnabled()) {
    const body = transcript.map((t) => `第${t.round}輪 · ${t.speaker}（${t.role}）：${t.text}`).join('\n');
    const user = [
      `會議主題：「${topic}」`,
      `與會者：${participants.map((p) => p.name).join('、')}`,
      '',
      '逐字紀錄：',
      body,
      '',
      report ? `會議報告（供對照決議）：\n${String(report).slice(0, 2000)}` : '',
      '',
      '請輸出每位與會者的記憶 JSON 陣列。',
    ].filter(Boolean).join('\n');
    const res = await generate({ system: DISTILL_SYSTEM, user, maxTokens: config.llm.output.summary, temperature: 0.3 });
    byName = res?.text ? parseDistillation(res.text, participants) : null;
    live = Boolean(byName);
  }

  const results = [];
  for (const p of participants) {
    // Idempotent: never distil a second memory for the same (employee, meeting)
    // — a re-run (or a partial-failure retry) would otherwise duplicate it.
    if (meetingId && findMemoryDocument(p.id, meetingId)) continue;
    const memory = byName?.get(p.name) || fallbackMemory(p, topic, transcript);
    if (!memory) continue;
    const doc = insertDocument(p.id, {
      title: `會議記憶：${topic}`,
      content: normalizeTraditional(memory), // enforce TC before it enters the KB
      source: 'memory',
      tags: ['memory', 'meeting'],
      metadata: { meetingId, topic, distilled: live ? 'live' : 'deterministic' },
    });
    results.push({ employeeId: p.id, documentId: doc.id, live });
  }
  if (results.length) scheduleEmbedding(); // fire-and-forget; no-op unless enabled
  // Now that each participant has a fresh memory, tidy up any whose backlog has
  // grown past the threshold (fire-and-forget, single-flight, no-op when off).
  for (const r of results) scheduleConsolidation(r.employeeId);
  return results;
}
