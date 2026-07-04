import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { listEmployees } from '../storage/employees.repo.js';
import { listMeetings } from '../storage/meetings.repo.js';
import { listGoals } from '../storage/goals.repo.js';
import { retrievalStats } from '../storage/retrieval.js';
import { llmEnabled } from '../reasoning/llm.js';
import { getSettings } from '../services/settings.service.js';
import { getRuntimeAdapter } from '../runtime/index.js';
import { ingestCapability } from '../services/knowledge.service.js';

export const healthRouter = Router();

healthRouter.get('/health', asyncHandler(async (_req, res) => {
  const kb = retrievalStats();
  const settings = getSettings();
  // The default standalone runtime is always ready; report whether its agent
  // turns run on the live model (Gemma) or the offline deterministic engine.
  const standalone = await getRuntimeAdapter('standalone').health();
  // Live probe of the OPTIONAL OpenClaw integration so callers can show whether
  // real subagent execution is available right now (independent of which mode is
  // selected).
  const openclaw = await getRuntimeAdapter('openclaw').health();
  // Document-ingestion capability (Phase 7): whether MarkItDown is reachable and
  // which upload types are supported (text-like types always work via fallback).
  const ingest = await ingestCapability();
  res.json({
    ok: true,
    llm: llmEnabled(),
    runtime: settings.runtimeMode,
    runtimeLabel: settings.runtimeLabel,
    standalone: {
      live: standalone.live,
      engine: standalone.engine,
      model: standalone.model,
    },
    openclaw: {
      live: openclaw.live,
      engine: openclaw.engine,
      gateway: openclaw.gateway,
      version: openclaw.version,
      disabled: openclaw.disabled,
    },
    ingest,
    counts: {
      employees: listEmployees().length,
      documents: kb.documents,
      chunks: kb.chunks,
      meetings: listMeetings().length,
      goals: listGoals().length,
    },
  });
}));
