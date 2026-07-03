// Storage layer: employees. Pure data access — no business logic. Returns/accepts
// plain JS objects with the API-facing shape (expertise as an array, camelCase).
import { getDb } from '../db/connection.js';
import { withTx } from '../db/tx.js';
import { id, now } from '../util/ids.js';

const parseJson = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

function rowToEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    roleTitle: row.role_title,
    personality: row.personality,
    expertise: parseJson(row.expertise, []),
    objectives: row.objectives,
    communicationStyle: row.communication_style,
    profile: row.profile,
    createdAt: row.created_at,
  };
}

export function listEmployees() {
  const rows = getDb()
    .prepare('SELECT * FROM employees ORDER BY created_at ASC')
    .all();
  return rows.map(rowToEmployee);
}

export function getEmployee(employeeId) {
  const row = getDb().prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  return rowToEmployee(row);
}

export function getEmployees(ids = []) {
  return ids.map(getEmployee).filter(Boolean);
}

export function insertEmployee(data) {
  const emp = {
    id: id('emp'),
    name: data.name,
    roleTitle: data.roleTitle,
    personality: data.personality || '',
    expertise: Array.isArray(data.expertise) ? data.expertise : [],
    objectives: data.objectives || '',
    communicationStyle: data.communicationStyle || '',
    profile: data.profile || '',
    createdAt: now(),
  };
  getDb()
    .prepare(`INSERT INTO employees
      (id, name, role_title, personality, expertise, objectives, communication_style, profile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      emp.id, emp.name, emp.roleTitle, emp.personality,
      JSON.stringify(emp.expertise), emp.objectives, emp.communicationStyle,
      emp.profile, emp.createdAt,
    );
  return emp;
}

export function updateEmployee(employeeId, patch) {
  const existing = getEmployee(employeeId);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    expertise: patch.expertise !== undefined
      ? (Array.isArray(patch.expertise) ? patch.expertise : existing.expertise)
      : existing.expertise,
  };
  getDb()
    .prepare(`UPDATE employees SET
      name = ?, role_title = ?, personality = ?, expertise = ?,
      objectives = ?, communication_style = ?, profile = ?
      WHERE id = ?`)
    .run(
      merged.name, merged.roleTitle, merged.personality,
      JSON.stringify(merged.expertise), merged.objectives,
      merged.communicationStyle, merged.profile, employeeId,
    );
  return merged;
}

export function deleteEmployee(employeeId) {
  // ON DELETE CASCADE clears documents + chunks; FTS rows are cleared explicitly
  // by the knowledge repo path, but a direct employee delete needs manual FTS
  // cleanup since FTS5 tables don't honor foreign keys.
  const db = getDb();
  return withTx(db, () => {
    db.prepare('DELETE FROM chunks_fts WHERE employee_id = ?').run(employeeId);
    const info = db.prepare('DELETE FROM employees WHERE id = ?').run(employeeId);
    return info.changes;
  }) > 0;
}
