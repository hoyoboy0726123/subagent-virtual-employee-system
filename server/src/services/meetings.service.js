// Service: meetings. Resolves participants, delegates the actual orchestration
// to the active runtime adapter, and persists the result.
import * as repo from '../storage/meetings.repo.js';
import { getEmployees } from '../storage/employees.repo.js';
import { getActiveRuntime } from './settings.service.js';
import { badRequest, notFound } from '../util/http.js';

export function list() {
  return repo.listMeetings();
}

export function get(id) {
  const m = repo.getMeeting(id);
  if (!m) throw notFound('meeting not found');
  return m;
}

export async function create({ topic, participantIds, rounds } = {}) {
  const participants = getEmployees(participantIds || []);
  if (!topic || participants.length === 0) {
    throw badRequest('topic and at least one participant are required');
  }
  const boundedRounds = Math.min(Math.max(Number(rounds) || 3, 1), 5);

  const runtime = getActiveRuntime();
  const result = await runtime.runMeeting({ topic, participants, rounds: boundedRounds });

  return repo.insertMeeting({
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
}

export function remove(id) {
  if (!repo.deleteMeeting(id)) throw notFound('meeting not found');
  return { ok: true };
}
