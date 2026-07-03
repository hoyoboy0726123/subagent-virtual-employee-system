import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as meetings from '../services/meetings.service.js';

export const meetingsRouter = Router();

meetingsRouter.get('/meetings', asyncHandler(async (_req, res) => {
  res.json(meetings.list());
}));

meetingsRouter.get('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.get(req.params.id));
}));

meetingsRouter.post('/meetings', asyncHandler(async (req, res) => {
  res.status(201).json(await meetings.create(req.body || {}));
}));

meetingsRouter.delete('/meetings/:id', asyncHandler(async (req, res) => {
  res.json(meetings.remove(req.params.id));
}));
