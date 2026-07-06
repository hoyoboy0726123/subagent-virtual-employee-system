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

// Streaming variant (Phase 15): Server-Sent Events with live progress — one
// event per round/turn as the multi-agent conversation actually unfolds, then
// {type:'done', meeting} (or {type:'error'}). The client reads it with fetch +
// ReadableStream; the non-streaming POST above stays for API compatibility.
meetingsRouter.post('/meetings/stream', asyncHandler(async (req, res) => {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    const meeting = await meetings.create(req.body || {}, send);
    send({ type: 'done', meeting });
  } catch (err) {
    send({ type: 'error', error: err.message || '內部錯誤' });
  } finally {
    res.end();
  }
}));

meetingsRouter.delete('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.remove(req.params.id));
}));
