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

function matchesText(goal, q = '') {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    goal.title,
    goal.description,
    goal.output,
    ...(goal.assignees || []).flatMap((a) => [a.name, a.roleTitle]),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function matchesAssignee(goal, assigneeId = '') {
  if (!assigneeId) return true;
  return (goal.assigneeIds || []).includes(assigneeId);
}

function matchesRuntime(goal, runtime = '') {
  if (!runtime) return true;
  return goal.runtime?.mode === runtime || goal.runtime?.engine === runtime;
}

function matchesLive(goal, live = '') {
  if (live === '' || live === undefined || live === null) return true;
  const truthy = String(live) === 'true';
  return Boolean(goal.runtime?.live && !goal.runtime?.fallback) === truthy;
}

function matchesStatus(goal, status = '') {
  if (!status) return true;
  return goal.status === status;
}

function sortGoals(items, sort = 'newest') {
  const list = [...items];
  switch (sort) {
    case 'oldest':
      return list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    case 'title-asc':
      return list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-Hant'));
    case 'title-desc':
      return list.sort((a, b) => String(b.title).localeCompare(String(a.title), 'zh-Hant'));
    case 'status':
      return list.sort((a, b) => String(a.status).localeCompare(String(b.status)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    case 'newest':
    default:
      return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

export function listGoals(opts = {}) {
  const all = getDb()
    .prepare('SELECT * FROM goals ORDER BY created_at DESC')
    .all()
    .map(rowToGoal);

  const filtered = sortGoals(all.filter((goal) => (
    matchesText(goal, opts.q)
    && matchesAssignee(goal, opts.assigneeId)
    && matchesRuntime(goal, opts.runtime)
    && matchesLive(goal, opts.live)
    && matchesStatus(goal, opts.status)
  )), opts.sort);

  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10, 1), 100);
  const page = Math.max(Number(opts.page) || 1, 1);
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    hasMore: start + pageSize < total,
    filters: {
      q: opts.q || '',
      assigneeId: opts.assigneeId || '',
      runtime: opts.runtime || '',
      live: opts.live === undefined ? '' : String(opts.live),
      status: opts.status || '',
      sort: opts.sort || 'newest',
    },
  };
}

export function listAllGoals() {
  return listGoals({ page: 1, pageSize: 1000000 }).items;
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
