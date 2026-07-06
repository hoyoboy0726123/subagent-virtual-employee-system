// Service: goals. Resolves assignees, delegates execution to the active runtime
// adapter, and persists. Status/task updates stay simple CRUD.
import * as repo from '../storage/goals.repo.js';
import { getEmployees } from '../storage/employees.repo.js';
import { getActiveRuntime } from './settings.service.js';
import { badRequest, notFound } from '../util/http.js';

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

export function remove(id) {
  if (!repo.deleteGoal(id)) throw notFound('找不到該目標');
  return { ok: true };
}
