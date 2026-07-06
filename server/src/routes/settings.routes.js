import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as settings from '../services/settings.service.js';

export const settingsRouter = Router();

// Includes per-runtime health so the UI can show what each mode will do.
settingsRouter.get('/settings', asyncHandler(async (_req, res) => {
  res.json(await settings.getSettingsWithHealth());
}));

// Update settings: runtime mode (standalone | openclaw) and/or the web-search
// toggle. Each key is applied only when present, so the UI can PUT one at a time.
settingsRouter.put('/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  let result;
  if (body.runtimeMode !== undefined) result = settings.setRuntimeMode(body.runtimeMode);
  if (body.webSearchEnabled !== undefined) result = settings.setWebSearchEnabled(Boolean(body.webSearchEnabled));
  res.json(result || settings.getSettings());
}));
