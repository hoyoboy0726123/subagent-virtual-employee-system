// Service: meetings. Resolves participants, delegates the actual orchestration
// to the active runtime adapter, and persists the result.
import * as repo from '../storage/meetings.repo.js';
import { getEmployees } from '../storage/employees.repo.js';
import { getActiveRuntime } from './settings.service.js';
import { distillMeetingMemories } from '../orchestration/MemoryDistiller.js';
import { badRequest, notFound } from '../util/http.js';

export function list(filters = {}) {
  return repo.listMeetings(filters);
}

export function get(id) {
  const m = repo.getMeeting(id);
  if (!m) throw notFound('找不到該會議');
  return m;
}

export async function create({ topic, participantIds, rounds } = {}, onEvent) {
  const participants = getEmployees(participantIds || []);
  if (!topic || participants.length === 0) {
    throw badRequest('主題與至少一位與會者為必填');
  }
  const boundedRounds = Math.min(Math.max(Number(rounds) || 3, 1), 5);

  const runtime = getActiveRuntime();
  const result = await runtime.runMeeting({ topic, participants, rounds: boundedRounds, onEvent });

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
