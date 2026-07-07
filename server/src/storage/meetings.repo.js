// Storage layer: meetings. JSON columns hold the transcript/minutes/grounding
// blobs; everything is serialized on write and parsed on read.
import { getDb } from '../db/connection.js';
import { id, now } from '../util/ids.js';

const j = (s, f) => { try { return JSON.parse(s); } catch { return f; } };

function rowToMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    topic: row.topic,
    participantIds: j(row.participant_ids, []),
    participants: j(row.participants, []),
    rounds: row.rounds,
    transcript: j(row.transcript, []),
    minutes: j(row.minutes, {}),
    report: row.report,
    grounding: j(row.grounding, []),
    runtime: j(row.runtime, {}),
    status: row.status || 'concluded',
    createdAt: row.created_at,
  };
}

function matchesText(meeting, q = '') {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    meeting.topic,
    ...(meeting.participants || []).flatMap((p) => [p.name, p.roleTitle]),
    meeting.report,
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function matchesParticipant(meeting, participantId = '') {
  if (!participantId) return true;
  return (meeting.participantIds || []).includes(participantId);
}

function matchesRuntime(meeting, runtime = '') {
  if (!runtime) return true;
  return meeting.runtime?.mode === runtime || meeting.runtime?.engine === runtime;
}

function matchesLive(meeting, live = '') {
  if (live === '' || live === undefined || live === null) return true;
  const truthy = String(live) === 'true';
  return Boolean(meeting.runtime?.live && !meeting.runtime?.fallback) === truthy;
}

function sortMeetings(items, sort = 'newest') {
  const list = [...items];
  switch (sort) {
    case 'oldest':
      return list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    case 'topic-asc':
      return list.sort((a, b) => String(a.topic).localeCompare(String(b.topic), 'zh-Hant'));
    case 'topic-desc':
      return list.sort((a, b) => String(b.topic).localeCompare(String(a.topic), 'zh-Hant'));
    case 'newest':
    default:
      return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

export function listMeetings(opts = {}) {
  const all = getDb()
    .prepare('SELECT * FROM meetings ORDER BY created_at DESC')
    .all()
    .map(rowToMeeting);

  const filtered = sortMeetings(all.filter((meeting) => (
    matchesText(meeting, opts.q)
    && matchesParticipant(meeting, opts.participantId)
    && matchesRuntime(meeting, opts.runtime)
    && matchesLive(meeting, opts.live)
  )), opts.sort);

  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10, 1), 100);
  const page = Math.max(Number(opts.page) || 1, 1);
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    hasMore: start + pageSize < total,
    filters: {
      q: opts.q || '',
      participantId: opts.participantId || '',
      runtime: opts.runtime || '',
      live: opts.live === undefined ? '' : String(opts.live),
      sort: opts.sort || 'newest',
    },
  };
}

export function listAllMeetings() {
  return listMeetings({ page: 1, pageSize: 1000000 }).items;
}

export function getMeeting(meetingId) {
  return rowToMeeting(getDb().prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId));
}

export function insertMeeting(data) {
  const meeting = {
    id: id('mtg'),
    topic: data.topic,
    participantIds: data.participantIds || [],
    participants: data.participants || [],
    rounds: data.rounds || 3,
    transcript: data.transcript || [],
    minutes: data.minutes || {},
    report: data.report || '',
    grounding: data.grounding || [],
    runtime: data.runtime || {},
    status: data.status || 'concluded',
    createdAt: now(),
  };
  getDb()
    .prepare(`INSERT INTO meetings
      (id, topic, participant_ids, participants, rounds, transcript, minutes, report, grounding, runtime, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      meeting.id, meeting.topic, JSON.stringify(meeting.participantIds),
      JSON.stringify(meeting.participants), meeting.rounds,
      JSON.stringify(meeting.transcript), JSON.stringify(meeting.minutes),
      meeting.report, JSON.stringify(meeting.grounding),
      JSON.stringify(meeting.runtime), meeting.status, meeting.createdAt,
    );
  return meeting;
}

/**
 * Patch a live meeting (Phase 16: continue / interject / conclude update the
 * stored transcript, artifacts, runtime stats, rounds, and status).
 */
export function updateMeeting(meetingId, patch = {}) {
  const existing = getMeeting(meetingId);
  if (!existing) return null;
  const merged = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
  getDb()
    .prepare(`UPDATE meetings SET
      rounds = ?, transcript = ?, minutes = ?, report = ?, grounding = ?, runtime = ?, status = ?
      WHERE id = ?`)
    .run(
      merged.rounds, JSON.stringify(merged.transcript), JSON.stringify(merged.minutes),
      merged.report, JSON.stringify(merged.grounding), JSON.stringify(merged.runtime),
      merged.status, meetingId,
    );
  return merged;
}

export function deleteMeeting(meetingId) {
  return getDb().prepare('DELETE FROM meetings WHERE id = ?').run(meetingId).changes > 0;
}
