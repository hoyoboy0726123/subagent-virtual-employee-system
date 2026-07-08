import { Router } from 'express';
import { asyncHandler, sendDownload } from '../util/http.js';
import { streamRun } from '../util/sse.js';
import * as meetings from '../services/meetings.service.js';
import { buildMeetingExport } from '../export/reportDoc.js';

export const meetingsRouter = Router();

meetingsRouter.get('/meetings', asyncHandler(async (req, res) => {
  res.json(meetings.list(req.query || {}));
}));

meetingsRouter.get('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.get(req.params.id));
}));

// Download the meeting report as a Word document (default) or Markdown/plain text.
meetingsRouter.get('/meetings/:id/export', asyncHandler(async (req, res) => {
  const meeting = meetings.get(req.params.id);
  const artifact = await buildMeetingExport(meeting, String(req.query.format || 'docx'));
  sendDownload(res, artifact);
}));

meetingsRouter.post('/meetings', asyncHandler(async (req, res) => {
  res.status(201).json(await meetings.create(req.body || {}));
}));

// Streaming endpoints emit one event per round/turn, then {type:'done',
// meeting} (or {type:'error'}). SSE plumbing (heartbeat, abort-on-disconnect)
// lives in util/sse.js; the abort `signal` is threaded into the orchestrator so
// closing the tab stops the run at the next round boundary.

// Legacy one-shot streaming run (rounds + auto-conclusion), kept for API
// compatibility; the interactive lifecycle below is what the UI uses.
meetingsRouter.post('/meetings/stream', asyncHandler(async (req, res) => {
  await streamRun(req, res, (send, signal) => meetings.create(req.body || {}, send, signal), 'meeting');
}));

// --- Phase 16: manager-chaired lifecycle ------------------------------------
// Start a discussion. It STOPS after the requested rounds with status
// 'discussing' — no minutes/report yet; the manager decides what happens next.
meetingsRouter.post('/meetings/discuss/stream', asyncHandler(async (req, res) => {
  await streamRun(req, res, (send, signal) => meetings.startDiscussion(req.body || {}, send, signal), 'meeting');
}));

// Continue a discussing meeting for more rounds (transcript carries over).
meetingsRouter.post('/meetings/:id/continue/stream', asyncHandler(async (req, res) => {
  await streamRun(req, res, (send, signal) => meetings.continueDiscussion(req.params.id, req.body || {}, send, signal), 'meeting');
}));

// Manager interjection — live (runId of an in-flight segment; works even
// before the first segment is persisted) or stored onto the transcript.
meetingsRouter.post('/meetings/interject', asyncHandler(async (req, res) => {
  const { meetingId, ...rest } = req.body || {};
  res.json(meetings.addInterjection(meetingId, rest));
}));

// The manager concludes the meeting: minutes + report + memory distillation.
meetingsRouter.post('/meetings/:id/conclude/stream', asyncHandler(async (req, res) => {
  await streamRun(req, res, (send) => meetings.concludeDiscussion(req.params.id, send), 'meeting');
}));

// Reopen a CONCLUDED meeting — the discussion continues on the same transcript
// (the next 作結 replaces the minutes/report and re-distills memories).
meetingsRouter.post('/meetings/:id/reopen', asyncHandler(async (req, res) => {
  res.json(await meetings.reopenDiscussion(req.params.id)); // withLock → Promise
}));

meetingsRouter.delete('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.remove(req.params.id));
}));
