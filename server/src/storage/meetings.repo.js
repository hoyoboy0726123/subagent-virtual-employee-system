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
    createdAt: row.created_at,
  };
}

export function listMeetings() {
  return getDb()
    .prepare('SELECT * FROM meetings ORDER BY created_at DESC')
    .all()
    .map(rowToMeeting);
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
    createdAt: now(),
  };
  getDb()
    .prepare(`INSERT INTO meetings
      (id, topic, participant_ids, participants, rounds, transcript, minutes, report, grounding, runtime, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      meeting.id, meeting.topic, JSON.stringify(meeting.participantIds),
      JSON.stringify(meeting.participants), meeting.rounds,
      JSON.stringify(meeting.transcript), JSON.stringify(meeting.minutes),
      meeting.report, JSON.stringify(meeting.grounding),
      JSON.stringify(meeting.runtime), meeting.createdAt,
    );
  return meeting;
}

export function deleteMeeting(meetingId) {
  return getDb().prepare('DELETE FROM meetings WHERE id = ?').run(meetingId).changes > 0;
}
