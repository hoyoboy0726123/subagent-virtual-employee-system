import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as settings from '../services/settings.service.js';

export const settingsRouter = Router();

settingsRouter.get('/settings', asyncHandler(async (_req, res) => {
  res.json(settings.getSettings());
}));

// Update settings. Currently just the web-search toggle; each key is applied
// only when present so the UI can PUT one at a time.
settingsRouter.put('/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  let result;
  if (body.webSearchEnabled !== undefined) result = settings.setWebSearchEnabled(Boolean(body.webSearchEnabled));
  res.json(result || settings.getSettings());
}));
