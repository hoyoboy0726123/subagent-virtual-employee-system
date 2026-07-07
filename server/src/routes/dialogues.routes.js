// Routes: manager 1-on-1 dialogues (Phase 19).
//
//   POST   /api/employees/:id/dialogue        → open (or resume) the 1-on-1
//   GET    /api/employees/:id/dialogues       → history for that employee
//   GET    /api/dialogues/:id                 → one dialogue
//   POST   /api/dialogues/:id/messages {text} → manager speaks; employee replies
//   POST   /api/dialogues/:id/close {save}    → end it; optionally save record to knowledge base
//   DELETE /api/dialogues/:id
import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as dialogues from '../services/dialogues.service.js';

export const dialoguesRouter = Router();

dialoguesRouter.post('/employees/:id/dialogue', asyncHandler(async (req, res) => {
  res.status(201).json(dialogues.open(req.params.id));
}));

dialoguesRouter.get('/employees/:id/dialogues', asyncHandler(async (req, res) => {
  res.json(dialogues.listForEmployee(req.params.id));
}));

dialoguesRouter.get('/dialogues/:id', asyncHandler(async (req, res) => {
  res.json(dialogues.get(req.params.id));
}));

dialoguesRouter.post('/dialogues/:id/messages', asyncHandler(async (req, res) => {
  res.json(await dialogues.say(req.params.id, (req.body || {}).text));
}));

dialoguesRouter.post('/dialogues/:id/close', asyncHandler(async (req, res) => {
  res.json(await dialogues.close(req.params.id, req.body || {}));
}));

dialoguesRouter.delete('/dialogues/:id', asyncHandler(async (req, res) => {
  res.json(dialogues.remove(req.params.id));
}));
