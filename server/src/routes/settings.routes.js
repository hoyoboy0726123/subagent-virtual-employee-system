import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as settings from '../services/settings.service.js';

export const settingsRouter = Router();

// Includes per-runtime health so the UI can show what each mode will do.
settingsRouter.get('/settings', asyncHandler(async (_req, res) => {
  res.json(await settings.getSettingsWithHealth());
}));

// Switch the active runtime mode (simulated | openclaw).
settingsRouter.put('/settings', asyncHandler(async (req, res) => {
  res.json(settings.setRuntimeMode((req.body || {}).runtimeMode));
}));
