import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { listEmployees } from '../storage/employees.repo.js';
import { listAllMeetings } from '../storage/meetings.repo.js';
import { listAllGoals } from '../storage/goals.repo.js';
import { retrievalStats } from '../storage/retrieval.js';

export const dashboardRouter = Router();

function liveRun(run) {
  return Boolean(run?.runtime?.live && !run?.runtime?.fallback);
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(3)) : 0;
}

dashboardRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  const employees = listEmployees();
  const meetings = listAllMeetings();
  const goals = listAllGoals();
  const kb = retrievalStats();
  const liveMeetings = meetings.filter(liveRun).length;
  const liveGoals = goals.filter(liveRun).length;
  const totalMeetingTurns = meetings.reduce((sum, m) => sum + Number(m.runtime?.totalTurns || 0), 0);
  const liveMeetingTurns = meetings.reduce((sum, m) => sum + Number(m.runtime?.liveTurns || 0), 0);
  const totalGoalTurns = goals.reduce((sum, g) => sum + Number(g.runtime?.totalTurns || 0), 0);
  const liveGoalTurns = goals.reduce((sum, g) => sum + Number(g.runtime?.liveTurns || 0), 0);

  res.json({
    counts: {
      employees: employees.length,
      documents: kb.documents,
      chunks: kb.chunks,
      meetings: meetings.length,
      goals: goals.length,
    },
    knowledge: {
      avgChunksPerDocument: kb.documents ? Number((kb.chunks / kb.documents).toFixed(1)) : 0,
    },
    runs: {
      liveMeetings,
      offlineMeetings: meetings.length - liveMeetings,
      liveGoals,
      offlineGoals: goals.length - liveGoals,
      liveRunRatio: ratio(liveMeetings + liveGoals, meetings.length + goals.length),
      liveTurnRatio: ratio(liveMeetingTurns + liveGoalTurns, totalMeetingTurns + totalGoalTurns),
    },
  });
}));
