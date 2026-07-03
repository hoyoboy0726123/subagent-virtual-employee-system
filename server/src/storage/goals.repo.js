// Storage layer: goals.
import { getDb } from '../db/connection.js';
import { id, now } from '../util/ids.js';

const j = (s, f) => { try { return JSON.parse(s); } catch { return f; } };

function rowToGoal(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assigneeIds: j(row.assignee_ids, []),
    assignees: j(row.assignees, []),
    status: row.status,
    tasks: j(row.tasks, []),
    output: row.output,
    grounding: j(row.grounding, []),
    runtime: j(row.runtime, {}),
    createdAt: row.created_at,
  };
}

export function listGoals() {
  return getDb()
    .prepare('SELECT * FROM goals ORDER BY created_at DESC')
    .all()
    .map(rowToGoal);
}

export function getGoal(goalId) {
  return rowToGoal(getDb().prepare('SELECT * FROM goals WHERE id = ?').get(goalId));
}

export function insertGoal(data) {
  const goal = {
    id: id('goal'),
    title: data.title,
    description: data.description || '',
    assigneeIds: data.assigneeIds || [],
    assignees: data.assignees || [],
    status: data.status || 'in-progress',
    tasks: data.tasks || [],
    output: data.output || '',
    grounding: data.grounding || [],
    runtime: data.runtime || {},
    createdAt: now(),
  };
  getDb()
    .prepare(`INSERT INTO goals
      (id, title, description, assignee_ids, assignees, status, tasks, output, grounding, runtime, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      goal.id, goal.title, goal.description, JSON.stringify(goal.assigneeIds),
      JSON.stringify(goal.assignees), goal.status, JSON.stringify(goal.tasks),
      goal.output, JSON.stringify(goal.grounding), JSON.stringify(goal.runtime),
      goal.createdAt,
    );
  return goal;
}

export function updateGoal(goalId, patch) {
  const existing = getGoal(goalId);
  if (!existing) return null;
  const merged = {
    ...existing,
    status: patch.status ?? existing.status,
    tasks: Array.isArray(patch.tasks) ? patch.tasks : existing.tasks,
  };
  getDb()
    .prepare('UPDATE goals SET status = ?, tasks = ? WHERE id = ?')
    .run(merged.status, JSON.stringify(merged.tasks), goalId);
  return merged;
}

export function deleteGoal(goalId) {
  return getDb().prepare('DELETE FROM goals WHERE id = ?').run(goalId).changes > 0;
}
