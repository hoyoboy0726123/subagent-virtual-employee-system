import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { listEmployees } from '../storage/employees.repo.js';
import { listMeetings } from '../storage/meetings.repo.js';
import { listGoals } from '../storage/goals.repo.js';
import { retrievalStats } from '../storage/retrieval.js';
import { llmEnabled } from '../reasoning/llm.js';
import { getSettings } from '../services/settings.service.js';

export const healthRouter = Router();

healthRouter.get('/health', asyncHandler(async (_req, res) => {
  const kb = retrievalStats();
  const settings = getSettings();
  res.json({
    ok: true,
    llm: llmEnabled(),
    runtime: settings.runtimeMode,
    runtimeLabel: settings.runtimeLabel,
    counts: {
      employees: listEmployees().length,
      documents: kb.documents,
      chunks: kb.chunks,
      meetings: listMeetings().length,
      goals: listGoals().length,
    },
  });
}));
