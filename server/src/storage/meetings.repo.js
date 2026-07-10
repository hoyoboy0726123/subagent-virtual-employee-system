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
    outputMode: row.output_mode || 'full',
    createdAt: row.created_at,
  };
}

// Lightweight list row (C1): only what the list UI shows — no transcript/
// minutes/grounding blobs are parsed. `groundingCount` comes from SQL.
function rowToMeetingLite(row) {
  return {
    id: row.id,
    topic: row.topic,
    participants: j(row.participants, []),
    status: row.status || 'concluded',
    groundingCount: row.groundingCount || 0,
    runtime: j(row.runtime, {}),
    createdAt: row.created_at,
  };
}

function meetingWhere(opts) {
  const where = [];
  const params = [];
  if (opts.q && String(opts.q).trim()) {
    const like = `%${String(opts.q).trim()}%`;
    where.push('(topic LIKE ? OR report LIKE ? OR participants LIKE ?)');
    params.push(like, like, like);
  }
  if (opts.participantId) { where.push('participant_ids LIKE ?'); params.push(`%"${opts.participantId}"%`); }
  if (opts.runtime) {
    where.push("(json_extract(runtime,'$.mode') = ? OR json_extract(runtime,'$.engine') = ?)");
    params.push(opts.runtime, opts.runtime);
  }
  if (opts.live === 'true' || opts.live === true) {
    where.push("(json_extract(runtime,'$.live') = 1 AND coalesce(json_extract(runtime,'$.fallback'),0) = 0)");
  } else if (opts.live === 'false' || opts.live === false) {
    where.push("NOT (json_extract(runtime,'$.live') = 1 AND coalesce(json_extract(runtime,'$.fallback'),0) = 0)");
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const MEETING_ORDER = {
  oldest: 'created_at ASC',
  'topic-asc': 'topic ASC',
  'topic-desc': 'topic DESC',
  newest: 'created_at DESC',
};

export function listMeetings(opts = {}) {
  const db = getDb();
  const { sql: whereSql, params } = meetingWhere(opts);
  const order = MEETING_ORDER[opts.sort] || MEETING_ORDER.newest;
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10, 1), 100);
  const page = Math.max(Number(opts.page) || 1, 1);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM meetings ${whereSql}`).get(...params).n;
  const items = db.prepare(
    `SELECT id, topic, participants, status, runtime, created_at,
            json_array_length(grounding) AS groundingCount
     FROM meetings ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, (page - 1) * pageSize).map(rowToMeetingLite);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    hasMore: page * pageSize < total,
    filters: {
      q: opts.q || '',
      participantId: opts.participantId || '',
      runtime: opts.runtime || '',
      live: opts.live === undefined ? '' : String(opts.live),
      sort: opts.sort || 'newest',
    },
  };
}

// Aggregate run stats for the dashboard — computed in SQL, no full-table load.
export function meetingStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS n FROM meetings').get().n;
  const live = db.prepare(
    "SELECT COUNT(*) AS n FROM meetings WHERE json_extract(runtime,'$.live') = 1 AND coalesce(json_extract(runtime,'$.fallback'),0) = 0",
  ).get().n;
  const turns = db.prepare(
    "SELECT coalesce(SUM(json_extract(runtime,'$.totalTurns')),0) AS total, coalesce(SUM(json_extract(runtime,'$.liveTurns')),0) AS live FROM meetings",
  ).get();
  return { total, live, totalTurns: turns.total, liveTurns: turns.live };
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
    outputMode: data.outputMode === 'conclusion' ? 'conclusion' : 'full',
    createdAt: now(),
  };
  getDb()
    .prepare(`INSERT INTO meetings
      (id, topic, participant_ids, participants, rounds, transcript, minutes, report, grounding, runtime, status, output_mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      meeting.id, meeting.topic, JSON.stringify(meeting.participantIds),
      JSON.stringify(meeting.participants), meeting.rounds,
      JSON.stringify(meeting.transcript), JSON.stringify(meeting.minutes),
      meeting.report, JSON.stringify(meeting.grounding),
      JSON.stringify(meeting.runtime), meeting.status, meeting.outputMode, meeting.createdAt,
    );
  return meeting;
}

/**
 * Patch a live meeting (Phase 16: continue / interject / conclude update the
 * stored transcript, artifacts, runtime stats, rounds, and status).
 * @param {object} [opts]
 * @param {string} [opts.expectStatus] compare-and-set guard: only patch when
 *   the CURRENT row still has this status (blocks double-conclude races).
 * @returns {object|null} the merged meeting, or null if not found / CAS missed.
 */
export function updateMeeting(meetingId, patch = {}, { expectStatus } = {}) {
  const existing = getMeeting(meetingId);
  if (!existing) return null;
  if (expectStatus !== undefined && existing.status !== expectStatus) return null;
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
