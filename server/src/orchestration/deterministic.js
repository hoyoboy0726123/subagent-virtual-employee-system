// Deterministic, fully-offline meeting/goal execution.
//
// This is the guaranteed baseline: the persona-driven engine grounded with RAG
// retrieval, no model calls of any kind. The standalone runtime uses it as a
// per-turn fallback (inside EmployeeAgentExecutor); the optional OpenClaw adapter
// uses this module as its whole-run fallback when its Gateway is unreachable.
import * as engine from '../reasoning/engine.js';
import { groundingFor } from '../storage/retrieval.js';

export function deterministicMeeting({ topic, participants, rounds }) {
  const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });
  const result = engine.runMeeting({ topic, participants, rounds, groundingByEmployee: byEmployee });
  return { ...result, grounding: flat };
}

export function deterministicGoal({ title, description, assignees }) {
  const query = `${title} ${description || ''}`.trim();
  const { byEmployee, flat } = groundingFor({ query, employees: assignees });
  const result = engine.executeGoal({ title, description, assignees, groundingByEmployee: byEmployee });
  return { ...result, grounding: flat };
}
