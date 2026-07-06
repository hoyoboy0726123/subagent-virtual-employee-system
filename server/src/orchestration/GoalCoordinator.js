// GoalCoordinator — a real, built-in, multi-agent collaborative goal execution.
//
// Each assignee is run as its own agent (EmployeeAgentExecutor), grounded in its
// own retrieved knowledge, and asked for the subtask it will own and how it will
// execute it — aware of the *other assignees' roles and expertise*, so it claims
// a non-overlapping slice and names its hand-offs. A coordinating manager agent
// (ReportSynthesizer) then integrates the real contributions into a single
// collaboration output. Runs fully in-process; no external runtime required.
import * as executor from './EmployeeAgentExecutor.js';
import { synthesizeGoalOutput } from './ReportSynthesizer.js';
import { newStats, record } from './MeetingOrchestrator.js';
import { groundingFor } from '../storage/retrieval.js';
import * as engine from '../reasoning/engine.js';

/**
 * @param {object} req  { title, description, assignees }
 * @returns {Promise<{tasks, output, grounding, stats}>}
 */
export async function executeGoal({ title, description, assignees }) {
  const query = `${title} ${description || ''}`.trim();
  const { byEmployee, flat } = groundingFor({ query, employees: assignees });

  // Give each assignee the *profiles* of the others (name, role, expertise), not
  // just their names — so the model can carve a complementary slice and name real
  // hand-offs instead of gesturing at "the team".
  const othersOf = (self) => assignees.filter((a) => a.id !== self.id);
  const namesOf = (list) => list.map((a) => a.name).join('、') || '（無，僅你一位負責人）';

  const stats = newStats();
  const tasks = [];

  for (let i = 0; i < assignees.length; i++) {
    const emp = assignees[i];
    const grounding = byEmployee[emp.id] || [];
    const others = othersOf(emp);
    const turn = await executor.goalTurn({
      employee: emp,
      grounding,
      context: {
        title,
        description,
        others: namesOf(others),
        otherProfiles: others,
      },
    });
    record(stats, turn.live);
    tasks.push({
      assignee: emp.name,
      assigneeId: emp.id,
      role: emp.roleTitle,
      subtask: engine.goalSubtask(emp, title),
      approach: turn.text,
      live: turn.live,
      toolCalls: turn.toolCalls || 0,
      status: 'in-progress',
      order: i + 1,
    });
  }

  const output = await synthesizeGoalOutput({ title, description, assignees, tasks, grounding: flat });
  record(stats, output.live);

  return { tasks, output: output.text, grounding: flat, stats };
}
