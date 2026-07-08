import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { listEmployees } from '../storage/employees.repo.js';
import { meetingStats } from '../storage/meetings.repo.js';
import { goalStats } from '../storage/goals.repo.js';
import { retrievalStats } from '../storage/retrieval.js';

export const dashboardRouter = Router();

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(3)) : 0;
}

dashboardRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  // All counts/sums come from SQL (COUNT / SUM(json_extract)) — no full-table
  // load or per-row JSON.parse of transcripts/grounding.
  const employees = listEmployees();
  const m = meetingStats();
  const g = goalStats();
  const kb = retrievalStats();

  res.json({
    counts: {
      employees: employees.length,
      documents: kb.documents,
      chunks: kb.chunks,
      meetings: m.total,
      goals: g.total,
    },
    knowledge: {
      avgChunksPerDocument: kb.documents ? Number((kb.chunks / kb.documents).toFixed(1)) : 0,
    },
    runs: {
      liveMeetings: m.live,
      offlineMeetings: m.total - m.live,
      liveGoals: g.live,
      offlineGoals: g.total - g.live,
      liveRunRatio: ratio(m.live + g.live, m.total + g.total),
      liveTurnRatio: ratio(m.liveTurns + g.liveTurns, m.totalTurns + g.totalTurns),
    },
  });
}));
