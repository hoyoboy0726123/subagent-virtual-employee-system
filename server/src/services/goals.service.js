// Service: goals. Resolves assignees, delegates execution to the active runtime
// adapter, and persists. Status/task updates stay simple CRUD.
import * as repo from '../storage/goals.repo.js';
import { getEmployees } from '../storage/employees.repo.js';
import { getActiveRuntime } from './settings.service.js';
import { taskDeliverableTurn } from '../orchestration/EmployeeAgentExecutor.js';
import { normalizeTraditional } from '../orchestration/output.js';
import { llmEnabled } from '../reasoning/llm.js';
import { badRequest, notFound } from '../util/http.js';
import { withLock } from '../util/locks.js';

const gkey = (id) => `goal:${id}`;

export function list(filters = {}) {
  return repo.listGoals(filters);
}

export function get(id) {
  const g = repo.getGoal(id);
  if (!g) throw notFound('找不到該目標');
  return g;
}

export async function create({ title, description, assigneeIds } = {}, onEvent) {
  const assignees = getEmployees(assigneeIds || []);
  if (!title || assignees.length === 0) {
    throw badRequest('標題與至少一位負責人為必填');
  }

  const runtime = getActiveRuntime();
  const result = await runtime.executeGoal({ title, description: description || '', assignees, onEvent });

  return repo.insertGoal({
    title,
    description: description || '',
    assigneeIds: assignees.map((p) => p.id),
    assignees: assignees.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    status: 'in-progress',
    tasks: result.tasks,
    output: result.output,
    grounding: result.grounding || [],
    runtime: result.runtime || {},
  });
}

export function update(id, patch = {}) {
  const updated = repo.updateGoal(id, patch);
  if (!updated) throw notFound('找不到該目標');
  return updated;
}

/**
 * Re-run a goal (the「重啟」for goals, mirroring the 1on1/meeting reopen).
 * The team collaborates AGAIN with the previous plan as context plus the
 * manager's revision instruction (highest priority), and the result REPLACES
 * tasks/output — one current plan per goal, never a stale duplicate. The
 * stored description stays the ORIGINAL; the prior-plan context is composed
 * per run only.
 */
export async function rerun(id, { instruction } = {}, onEvent) {
  const goal = get(id);
  const assignees = getEmployees(goal.assigneeIds || []);
  if (!assignees.length) throw badRequest('負責人已不存在，無法重新執行');

  const note = String(instruction || '').trim();
  const description = [
    goal.description || '',
    goal.output
      ? `【前一版協作計畫——請在此基礎上改進，而不是重新發明】\n${String(goal.output).slice(0, 4000)}`
      : '',
    note ? `【主管的修訂指示（最高優先）】\n${note}` : '',
  ].filter(Boolean).join('\n\n');

  const runtime = getActiveRuntime();
  const result = await runtime.executeGoal({ title: goal.title, description, assignees, onEvent });

  return update(id, {
    tasks: result.tasks,
    output: result.output,
    grounding: result.grounding || [],
    runtime: result.runtime || {},
    status: 'in-progress', // a re-run reopens the goal regardless of prior status
  });
}

export function remove(id) {
  if (!repo.deleteGoal(id)) throw notFound('找不到該目標');
  return { ok: true };
}

/**
 * EXECUTE one task of a goal into a real deliverable (Phase 20). The planning
 * run only produced each assignee's subtask + approach — this makes the
 * assignee actually DO the work (research-grade tool budget, honest citations)
 * and stores the artifact on the task, flipping it to 'done'. Live-brain only:
 * a fabricated offline "deliverable" would be worse than an honest refusal.
 * Serialized per goal so two executions can't clobber each other's task array.
 */
export async function executeTask(goalId, order) {
  return withLock(gkey(goalId), async () => {
    const goal = get(goalId);
    const idx = (goal.tasks || []).findIndex((t) => Number(t.order) === Number(order));
    if (idx < 0) throw notFound('找不到該任務');
    if (!llmEnabled()) {
      throw badRequest('執行交付需要即時大腦——請點頂欄 🔑 設定 Gemini 金鑰，或切換到已登入的 Claude／Codex 訂閱。');
    }
    const task = goal.tasks[idx];
    const [employee] = getEmployees([task.assigneeId]);
    if (!employee) throw badRequest('該任務的負責人已不存在');

    const others = (goal.tasks || [])
      .filter((t) => Number(t.order) !== Number(order))
      .map((t) => `- ${t.assignee}（${t.role}）：${t.subtask}`)
      .join('\n');

    const turn = await taskDeliverableTurn({ employee, goal, task, others });
    if (!turn) throw badRequest('模型這次沒有產出交付物，請再試一次。');

    const tasks = goal.tasks.map((t, i) => (i === idx ? {
      ...t,
      deliverable: normalizeTraditional(turn.text),
      deliverableCitations: turn.citations || [],
      deliveredAt: new Date().toISOString(),
      deliverableToolCalls: turn.toolCalls || 0,
      status: 'done',
    } : t));
    return update(goalId, { tasks });
  });
}
