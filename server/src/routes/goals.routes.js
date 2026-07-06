import { Router } from 'express';
import { asyncHandler, sendDownload } from '../util/http.js';
import * as goals from '../services/goals.service.js';
import { buildGoalExport } from '../export/reportDoc.js';

export const goalsRouter = Router();

goalsRouter.get('/goals', asyncHandler(async (req, res) => {
  res.json(goals.list(req.query || {}));
}));

goalsRouter.get('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.get(req.params.id));
}));

// Download the collaboration output as a Word document (default) or Markdown/plain text.
goalsRouter.get('/goals/:id/export', asyncHandler(async (req, res) => {
  const goal = goals.get(req.params.id);
  const artifact = await buildGoalExport(goal, String(req.query.format || 'docx'));
  sendDownload(res, artifact);
}));

goalsRouter.post('/goals', asyncHandler(async (req, res) => {
  res.status(201).json(await goals.create(req.body || {}));
}));

// Streaming variant (Phase 15): SSE progress — assignees now run in parallel,
// and each completed task streams as {type:'task'}, then {type:'done', goal}.
goalsRouter.post('/goals/stream', asyncHandler(async (req, res) => {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    const goal = await goals.create(req.body || {}, send);
    send({ type: 'done', goal });
  } catch (err) {
    send({ type: 'error', error: err.message || '內部錯誤' });
  } finally {
    res.end();
  }
}));

goalsRouter.put('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.update(req.params.id, req.body || {}));
}));

goalsRouter.delete('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.remove(req.params.id));
}));
