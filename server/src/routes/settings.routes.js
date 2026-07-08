import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as settings from '../services/settings.service.js';

export const settingsRouter = Router();

settingsRouter.get('/settings', asyncHandler(async (_req, res) => {
  res.json(settings.getSettings());
}));

// Update settings: the web-search toggle and/or the reasoning-brain selector.
// Each key is applied only when present so the UI can PUT one at a time.
settingsRouter.put('/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  let result;
  if (body.webSearchEnabled !== undefined) result = settings.setWebSearchEnabled(Boolean(body.webSearchEnabled));
  if (body.llmProvider !== undefined) result = settings.setLlmProvider(String(body.llmProvider));
  res.json(result || settings.getSettings());
}));

// Save UI-managed API keys (Gemini / Tavily). Stored in the local SQLite
// settings table (gitignored, single-user); '' clears back to the env fallback.
settingsRouter.put('/settings/api-keys', asyncHandler(async (req, res) => {
  const { gemini, tavily } = req.body || {};
  res.json(settings.setApiKeys({ gemini, tavily }));
}));

// Test-connect a key BEFORE saving it (or the stored one when `key` is absent).
settingsRouter.post('/settings/api-keys/test', asyncHandler(async (req, res) => {
  const { provider, key } = req.body || {};
  res.json(await settings.testApiKey(String(provider || ''), key));
}));
