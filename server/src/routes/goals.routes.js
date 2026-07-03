import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as goals from '../services/goals.service.js';

export const goalsRouter = Router();

goalsRouter.get('/goals', asyncHandler(async (_req, res) => {
  res.json(goals.list());
}));

goalsRouter.post('/goals', asyncHandler(async (req, res) => {
  res.status(201).json(await goals.create(req.body || {}));
}));

goalsRouter.put('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.update(req.params.id, req.body || {}));
}));

goalsRouter.delete('/goals/:id', asyncHandler(async (req, res) => {
  res.json(goals.remove(req.params.id));
}));
