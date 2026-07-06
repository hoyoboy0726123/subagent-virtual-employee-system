// Routes: autonomous research (Phase 14).
//
//   POST   /api/employees/:id/research   { topic }  → run research, store PENDING report
//   GET    /api/employees/:id/research               → that employee's reports
//   GET    /api/research                              → all reports (manager inbox)
//   POST   /api/research/:id/approve                  → ingest into knowledge base
//   POST   /api/research/:id/reject                   → archive without ingesting
//   DELETE /api/research/:id                          → remove a report record
import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as research from '../services/research.service.js';

export const researchRouter = Router();

researchRouter.post('/employees/:id/research', asyncHandler(async (req, res) => {
  res.status(201).json(await research.runResearch(req.params.id, (req.body || {}).topic));
}));

researchRouter.get('/employees/:id/research', asyncHandler(async (req, res) => {
  res.json(research.listResearch(req.params.id));
}));

researchRouter.get('/research', asyncHandler(async (_req, res) => {
  res.json(research.listResearch());
}));

researchRouter.post('/research/:id/approve', asyncHandler(async (req, res) => {
  res.json(research.approveResearch(req.params.id));
}));

researchRouter.post('/research/:id/reject', asyncHandler(async (req, res) => {
  res.json(research.rejectResearch(req.params.id));
}));

researchRouter.delete('/research/:id', asyncHandler(async (req, res) => {
  res.json(research.removeResearch(req.params.id));
}));
