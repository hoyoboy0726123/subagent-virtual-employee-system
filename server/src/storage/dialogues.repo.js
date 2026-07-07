// Storage layer: manager 1-on-1 dialogues (Phase 19).
import { getDb } from '../db/connection.js';
import { id, now } from '../util/ids.js';

const parse = (row) => row && ({
  id: row.id,
  employeeId: row.employee_id,
  transcript: JSON.parse(row.transcript || '[]'),
  status: row.status,
  savedDocId: row.saved_doc_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function insertDialogue(employeeId) {
  const did = id('dlg');
  const ts = now();
  getDb().prepare(`
    INSERT INTO dialogues (id, employee_id, transcript, status, created_at, updated_at)
    VALUES (?, ?, '[]', 'open', ?, ?)
  `).run(did, employeeId, ts, ts);
  return getDialogue(did);
}

export function getDialogue(dialogueId) {
  return parse(getDb().prepare('SELECT * FROM dialogues WHERE id = ?').get(dialogueId));
}

/** The employee's open dialogue, if any — 1on1s resume rather than fork. */
export function getOpenDialogue(employeeId) {
  return parse(getDb()
    .prepare("SELECT * FROM dialogues WHERE employee_id = ? AND status = 'open' ORDER BY created_at DESC")
    .get(employeeId));
}

export function listDialogues(employeeId) {
  return getDb()
    .prepare('SELECT * FROM dialogues WHERE employee_id = ? ORDER BY created_at DESC')
    .all(employeeId).map(parse);
}

export function updateDialogue(dialogueId, patch = {}) {
  const existing = getDialogue(dialogueId);
  if (!existing) return null;
  const merged = { ...existing, ...patch, id: existing.id };
  getDb().prepare(`
    UPDATE dialogues SET transcript = ?, status = ?, saved_doc_id = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(merged.transcript), merged.status, merged.savedDocId, now(), dialogueId);
  return getDialogue(dialogueId);
}

export function deleteDialogue(dialogueId) {
  return getDb().prepare('DELETE FROM dialogues WHERE id = ?').run(dialogueId).changes > 0;
}
