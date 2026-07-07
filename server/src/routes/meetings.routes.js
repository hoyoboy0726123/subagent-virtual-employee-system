import { Router } from 'express';
import { asyncHandler, sendDownload } from '../util/http.js';
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

// SSE plumbing shared by every streaming meeting endpoint: one event per
// round/turn as the conversation unfolds, then {type:'done', meeting} (or
// {type:'error'}). Clients read it with fetch + ReadableStream.
function sse(res) {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();
  return (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
}

async function streamRun(res, fn) {
  const send = sse(res);
  try {
    const meeting = await fn(send);
    send({ type: 'done', meeting });
  } catch (err) {
    send({ type: 'error', error: err.message || '內部錯誤' });
  } finally {
    res.end();
  }
}

// Legacy one-shot streaming run (rounds + auto-conclusion), kept for API
// compatibility; the interactive lifecycle below is what the UI uses.
meetingsRouter.post('/meetings/stream', asyncHandler(async (req, res) => {
  await streamRun(res, (send) => meetings.create(req.body || {}, send));
}));

// --- Phase 16: manager-chaired lifecycle ------------------------------------
// Start a discussion. It STOPS after the requested rounds with status
// 'discussing' — no minutes/report yet; the manager decides what happens next.
meetingsRouter.post('/meetings/discuss/stream', asyncHandler(async (req, res) => {
  await streamRun(res, (send) => meetings.startDiscussion(req.body || {}, send));
}));

// Continue a discussing meeting for more rounds (transcript carries over).
meetingsRouter.post('/meetings/:id/continue/stream', asyncHandler(async (req, res) => {
  await streamRun(res, (send) => meetings.continueDiscussion(req.params.id, req.body || {}, send));
}));

// Manager interjection — live (runId of an in-flight segment; works even
// before the first segment is persisted) or stored onto the transcript.
meetingsRouter.post('/meetings/interject', asyncHandler(async (req, res) => {
  const { meetingId, ...rest } = req.body || {};
  res.json(meetings.addInterjection(meetingId, rest));
}));

// The manager concludes the meeting: minutes + report + memory distillation.
meetingsRouter.post('/meetings/:id/conclude/stream', asyncHandler(async (req, res) => {
  await streamRun(res, (send) => meetings.concludeDiscussion(req.params.id, send));
}));

meetingsRouter.delete('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.remove(req.params.id));
}));
