import { Router } from 'express';
import { asyncHandler, sendDownload } from '../util/http.js';
import { streamRun } from '../util/sse.js';
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

// Streaming variant (Phase 15): SSE progress — assignees run in parallel, each
// completed task streams as {type:'task'}, then {type:'done', goal}. Shared SSE
// plumbing (heartbeat, abort-on-disconnect) lives in util/sse.js.
goalsRouter.post('/goals/stream', asyncHandler(async (req, res) => {
  await streamRun(req, res, (send) => goals.create(req.body || {}, send), 'goal');
}));

// EXECUTE one task into a real deliverable (Phase 20): the assignee does the
// work (web research + citations) and the artifact lands on the task.
goalsRouter.post('/goals/:id/tasks/:order/execute', asyncHandler(async (req, res) => {
  res.json(await goals.executeTask(req.params.id, req.params.order));
}));

// Re-run the collaboration with the previous plan + an optional manager
// instruction as context; the fresh result REPLACES tasks/output.
goalsRouter.post('/goals/:id/rerun', asyncHandler(async (req, res) => {
  res.json(await goals.rerun(req.params.id, req.body || {}));
}));

// Streaming variant — same SSE event shape as /goals/stream.
goalsRouter.post('/goals/:id/rerun/stream', asyncHandler(async (req, res) => {
  await streamRun(req, res, (send) => goals.rerun(req.params.id, req.body || {}, send), 'goal');
}));

goalsRouter.put('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.update(req.params.id, req.body || {}));
}));

goalsRouter.delete('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.remove(req.params.id));
}));
