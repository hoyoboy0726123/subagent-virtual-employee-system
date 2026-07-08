// Service: meetings. Resolves participants, delegates the actual orchestration
// to the active runtime adapter, and persists the result.
import * as repo from '../storage/meetings.repo.js';
import { getEmployees } from '../storage/employees.repo.js';
import { getActiveRuntime } from './settings.service.js';
import { distillMeetingMemories } from '../orchestration/MemoryDistiller.js';
import { interject as interjectLive } from '../orchestration/MeetingOrchestrator.js';
import { badRequest, notFound } from '../util/http.js';
import { id as newId } from '../util/ids.js';
import { withLock } from '../util/locks.js';

// Serialize continue/interject/conclude PER meeting so a long LLM await can't
// let two requests read the same transcript and clobber each other's turns.
const mkey = (id) => `meeting:${id}`;

const MANAGER_TURN = { speaker: '主管', role: '會議主持人', speakerId: 'manager' };

const boundRounds = (rounds, fallback = 3) => Math.min(Math.max(Number(rounds) || fallback, 1), 5);

// Interactive meetings need the rounds/conclude split; the optional OpenClaw
// adapter only implements the legacy one-shot shape.
function requireInteractiveRuntime() {
  const runtime = getActiveRuntime();
  if (typeof runtime.runMeetingRounds !== 'function') {
    throw badRequest('目前的執行環境不支援互動式會議，請切換回內建多代理。');
  }
  return runtime;
}

function mergeRuntime(prev = {}, next = {}) {
  const liveTurns = (prev.liveTurns || 0) + (next.liveTurns || 0);
  const totalTurns = (prev.totalTurns || 0) + (next.totalTurns || 0);
  return {
    ...next,
    liveTurns,
    totalTurns,
    live: liveTurns > 0,
    fallback: liveTurns === 0,
    model: next.model || prev.model || null,
    provider: next.provider || prev.provider || null,
    engine: liveTurns > 0
      ? (next.engine !== 'deterministic' ? next.engine : prev.engine)
      : 'deterministic',
  };
}

export function list(filters = {}) {
  return repo.listMeetings(filters);
}

export function get(id) {
  const m = repo.getMeeting(id);
  if (!m) throw notFound('找不到該會議');
  return m;
}

export async function create({ topic, participantIds, rounds } = {}, onEvent, signal) {
  const participants = getEmployees(participantIds || []);
  if (!topic || participants.length === 0) {
    throw badRequest('主題與至少一位與會者為必填');
  }
  const boundedRounds = Math.min(Math.max(Number(rounds) || 3, 1), 5);

  const runtime = getActiveRuntime();
  const result = await runtime.runMeeting({ topic, participants, rounds: boundedRounds, onEvent, signal });

  const meeting = repo.insertMeeting({
    topic,
    participantIds: participants.map((p) => p.id),
    participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    rounds: boundedRounds,
    transcript: result.transcript,
    minutes: result.minutes,
    report: result.report,
    grounding: result.grounding || [],
    runtime: result.runtime || {},
  });

  // Cross-meeting memory (Phase 15): distill what each participant should
  // remember and write it into their own knowledge base. Failures here must
  // never lose the meeting itself.
  try { onEvent?.({ type: 'memory' }); } catch { /* ignore */ }
  try {
    meeting.memories = await distillMeetingMemories({
      meetingId: meeting.id,
      topic,
      participants,
      transcript: result.transcript,
      report: result.report,
    });
  } catch (err) {
    console.warn(`[memory] distillation failed (meeting kept): ${err.message}`);
    meeting.memories = [];
  }
  return meeting;
}

export function remove(id) {
  if (!repo.deleteMeeting(id)) throw notFound('找不到該會議');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 16 — manager-chaired meeting lifecycle.
// A discussion runs in segments; between (and during) segments the MANAGER
// decides: continue for more rounds, interject to steer, or conclude — only
// concluding synthesizes the minutes/report and distills memories.
// ---------------------------------------------------------------------------

/** Start a discussion: run the first rounds, persist as status 'discussing'. */
export async function startDiscussion({ topic, participantIds, rounds } = {}, onEvent, signal) {
  const participants = getEmployees(participantIds || []);
  if (!topic || participants.length === 0) {
    throw badRequest('主題與至少一位與會者為必填');
  }
  const runtime = requireInteractiveRuntime();
  const runId = newId('run'); // the orchestrator registers the mailbox + emits 'run'

  const result = await runtime.runMeetingRounds({
    topic, participants, rounds: boundRounds(rounds), runId, onEvent, signal,
  });

  return repo.insertMeeting({
    topic,
    participantIds: participants.map((p) => p.id),
    participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    rounds: boundRounds(rounds),
    transcript: result.transcript,
    grounding: result.grounding || [],
    runtime: result.runtime || {},
    status: 'discussing',
  });
}

/** Continue a discussing meeting for more rounds (transcript carries over). */
export async function continueDiscussion(meetingId, { rounds } = {}, onEvent, signal) {
  return withLock(mkey(meetingId), async () => {
    const meeting = repo.getMeeting(meetingId);
    if (!meeting) throw notFound('找不到該會議');
    if (meeting.status !== 'discussing') throw badRequest('這場會議已經結束，無法繼續討論。');
    const participants = getEmployees(meeting.participantIds);
    if (!participants.length) throw badRequest('與會者已不存在');

    const runtime = requireInteractiveRuntime();
    const runId = newId('run'); // orchestrator registers the mailbox + emits 'run'

    const more = boundRounds(rounds, 1);
    const result = await runtime.runMeetingRounds({
      topic: meeting.topic,
      participants,
      rounds: more,
      priorTranscript: meeting.transcript,
      runId,
      onEvent,
      signal,
    });

    // Re-read: a stored interjection may have been appended while we ran.
    const fresh = repo.getMeeting(meetingId) || meeting;
    const updated = repo.updateMeeting(meetingId, {
      rounds: fresh.rounds + more,
      transcript: result.transcript,
      grounding: dedupeGrounding([...(fresh.grounding || []), ...(result.grounding || [])]),
      runtime: mergeRuntime(fresh.runtime, result.runtime),
    });
    if (!updated) throw notFound('會議在討論期間已被刪除');
    return updated;
  });
}

/**
 * Manager interjection. If the meeting is streaming right now (`runId` given),
 * the note is delivered live — the next speaker sees it before they talk;
 * otherwise it is appended to the stored transcript so the next 繼續討論
 * segment (and the final report) picks it up.
 */
export function addInterjection(meetingId, { text, runId } = {}) {
  const note = String(text || '').trim();
  if (!note) throw badRequest('請輸入要對團隊說的話');
  if (runId && interjectLive(runId, note)) return { ok: true, delivery: 'live' };

  if (!meetingId) throw badRequest('目前沒有進行中的討論段落可插話');
  const meeting = repo.getMeeting(meetingId);
  if (!meeting) throw notFound('找不到該會議');
  if (meeting.status !== 'discussing') throw badRequest('這場會議已經結束。');
  const lastRound = meeting.transcript.reduce((m, t) => Math.max(m, t.round || 0), 0);
  const turn = {
    round: lastRound || 1,
    roundTitle: '主管指示',
    ...MANAGER_TURN,
    text: note,
    live: true,
    isManager: true,
    toolCalls: 0,
    citations: [],
  };
  repo.updateMeeting(meetingId, { transcript: [...meeting.transcript, turn] });
  return { ok: true, delivery: 'stored', turn };
}

/** The manager concludes: synthesize minutes + report, distill memories. */
export async function concludeDiscussion(meetingId, onEvent) {
  const meeting = repo.getMeeting(meetingId);
  if (!meeting) throw notFound('找不到該會議');
  if (meeting.status !== 'discussing') throw badRequest('這場會議已經產出過報告。');
  if (!meeting.transcript.length) throw badRequest('還沒有任何討論內容可以總結。');
  const participants = getEmployees(meeting.participantIds);

  const runtime = requireInteractiveRuntime();
  const result = await runtime.concludeMeeting({
    topic: meeting.topic,
    participants,
    transcript: meeting.transcript,
    grounding: meeting.grounding,
    onEvent,
  });

  // CAS: flip discussing → concluded only if still discussing. Guards against a
  // double-conclude (each would otherwise write a duplicate report + a second
  // set of per-participant memories) and against deletion mid-run.
  const updated = repo.updateMeeting(meetingId, {
    minutes: result.minutes,
    report: result.report,
    runtime: mergeRuntime(meeting.runtime, result.runtime),
    status: 'concluded',
  }, { expectStatus: 'discussing' });
  if (!updated) throw badRequest('這場會議已經產出過報告或已被刪除。');

  try { onEvent?.({ type: 'memory' }); } catch { /* ignore */ }
  try {
    updated.memories = await distillMeetingMemories({
      meetingId,
      topic: meeting.topic,
      participants,
      transcript: meeting.transcript,
      report: result.report,
    });
  } catch (err) {
    console.warn(`[memory] distillation failed (meeting kept): ${err.message}`);
    updated.memories = [];
  }
  return updated;
}

function dedupeGrounding(list) {
  const seen = new Set();
  return list.filter((g) => {
    if (seen.has(g.chunkId)) return false;
    seen.add(g.chunkId);
    return true;
  });
}
