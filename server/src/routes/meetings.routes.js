import { Router } from 'express';
import { asyncHandler, sendDownload } from '../util/http.js';
import * as meetings from '../services/meetings.service.js';
import { buildMeetingExport } from '../export/reportDoc.js';

export const meetingsRouter = Router();

meetingsRouter.get('/meetings', asyncHandler(async (_req, res) => {
  res.json(meetings.list());
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

meetingsRouter.delete('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.remove(req.params.id));
}));
