import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { listEmployees } from '../storage/employees.repo.js';
import { listAllMeetings } from '../storage/meetings.repo.js';
import { listAllGoals } from '../storage/goals.repo.js';
import { retrievalStats } from '../storage/retrieval.js';
import { llmEnabled } from '../reasoning/llm.js';
import { webSearchConfigured, webSearchEnabled } from '../reasoning/tools.js';
import { config } from '../config.js';
import { getSettings } from '../services/settings.service.js';
import { getRuntimeAdapter } from '../runtime/index.js';
import { ingestCapability } from '../services/knowledge.service.js';

export const healthRouter = Router();

healthRouter.get('/health', asyncHandler(async (_req, res) => {
  const kb = retrievalStats();
  const settings = getSettings();
  // The standalone runtime is always ready; report whether its agent turns run
  // on the live model or the offline deterministic engine.
  const standalone = await getRuntimeAdapter('standalone').health();
  // Document-ingestion capability (Phase 7): whether MarkItDown is reachable and
  // which upload types are supported (text-like types always work via fallback).
  const ingest = await ingestCapability();
  res.json({
    ok: true,
    llm: llmEnabled(),
    runtime: 'standalone',
    runtimeLabel: settings.runtimeLabel,
    standalone: {
      live: standalone.live,
      engine: standalone.engine,
      model: standalone.model,
    },
    ingest,
    // Agentic tool use (Phase 13/14): search_knowledge is always available to
    // live agent turns; web_search needs BOTH a provider key and the in-app
    // toggle. `webSearchKey` lets the UI distinguish "no key" from "toggled off".
    tools: {
      knowledgeSearch: true,
      webSearch: webSearchEnabled(),
      webSearchKey: webSearchConfigured(),
      maxCallsPerTurn: config.tools.maxCallsPerTurn,
    },
    counts: {
      employees: listEmployees().length,
      documents: kb.documents,
      chunks: kb.chunks,
      meetings: listAllMeetings().length,
      goals: listAllGoals().length,
    },
  });
}));
