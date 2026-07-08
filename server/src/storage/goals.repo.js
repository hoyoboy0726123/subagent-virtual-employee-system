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

// Lightweight list row (C1): only what the list UI shows — no tasks/output/
// grounding blobs are parsed. `taskCount` comes from SQL, not a JSON.parse.
function rowToGoalLite(row) {
  return {
    id: row.id,
    title: row.title,
    assignees: j(row.assignees, []),
    status: row.status,
    taskCount: row.taskCount || 0,
    runtime: j(row.runtime, {}),
    createdAt: row.created_at,
  };
}

// Build the WHERE clause + bound params for the list filters, pushed to SQL so
// we never load/parse the whole table in JS.
function goalWhere(opts) {
  const where = [];
  const params = [];
  if (opts.q && String(opts.q).trim()) {
    const like = `%${String(opts.q).trim()}%`;
    where.push('(title LIKE ? OR description LIKE ? OR output LIKE ? OR assignees LIKE ?)');
    params.push(like, like, like, like);
  }
  if (opts.assigneeId) { where.push('assignee_ids LIKE ?'); params.push(`%"${opts.assigneeId}"%`); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.runtime) {
    where.push("(json_extract(runtime,'$.mode') = ? OR json_extract(runtime,'$.engine') = ?)");
    params.push(opts.runtime, opts.runtime);
  }
  if (opts.live === 'true' || opts.live === true) {
    where.push("(json_extract(runtime,'$.live') = 1 AND coalesce(json_extract(runtime,'$.fallback'),0) = 0)");
  } else if (opts.live === 'false' || opts.live === false) {
    where.push("NOT (json_extract(runtime,'$.live') = 1 AND coalesce(json_extract(runtime,'$.fallback'),0) = 0)");
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const GOAL_ORDER = {
  oldest: 'created_at ASC',
  'title-asc': 'title ASC',
  'title-desc': 'title DESC',
  status: 'status ASC, created_at DESC',
  newest: 'created_at DESC',
};

export function listGoals(opts = {}) {
  const db = getDb();
  const { sql: whereSql, params } = goalWhere(opts);
  const order = GOAL_ORDER[opts.sort] || GOAL_ORDER.newest;
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10, 1), 100);
  const page = Math.max(Number(opts.page) || 1, 1);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM goals ${whereSql}`).get(...params).n;
  const items = db.prepare(
    `SELECT id, title, assignees, status, runtime, created_at,
            json_array_length(tasks) AS taskCount
     FROM goals ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, (page - 1) * pageSize).map(rowToGoalLite);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    hasMore: page * pageSize < total,
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

// Aggregate run stats for the dashboard — computed in SQL, no full-table load.
export function goalStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS n FROM goals').get().n;
  const live = db.prepare(
    "SELECT COUNT(*) AS n FROM goals WHERE json_extract(runtime,'$.live') = 1 AND coalesce(json_extract(runtime,'$.fallback'),0) = 0",
  ).get().n;
  const turns = db.prepare(
    "SELECT coalesce(SUM(json_extract(runtime,'$.totalTurns')),0) AS total, coalesce(SUM(json_extract(runtime,'$.liveTurns')),0) AS live FROM goals",
  ).get();
  return { total, live, totalTurns: turns.total, liveTurns: turns.live };
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
