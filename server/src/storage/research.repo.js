// Storage layer: autonomous research reports (Phase 14).
import { getDb } from '../db/connection.js';
import { id } from '../util/ids.js';

const parse = (row) => row && ({
  id: row.id,
  employeeId: row.employee_id,
  topic: row.topic,
  report: row.report,
  sources: JSON.parse(row.sources || '[]'),
  queries: JSON.parse(row.queries || '[]'),
  status: row.status,
  live: Boolean(row.live),
  documentId: row.document_id,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
});

export function insertReport({ employeeId, topic, report, sources = [], queries = [], live = true }) {
  const rid = id('res');
  getDb().prepare(`
    INSERT INTO research_reports (id, employee_id, topic, report, sources, queries, status, live, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(rid, employeeId, topic, report, JSON.stringify(sources), JSON.stringify(queries), live ? 1 : 0, new Date().toISOString());
  return getReport(rid);
}

export function getReport(reportId) {
  return parse(getDb().prepare('SELECT * FROM research_reports WHERE id = ?').get(reportId));
}

export function listReports(employeeId) {
  const rows = employeeId
    ? getDb().prepare('SELECT * FROM research_reports WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId)
    : getDb().prepare('SELECT * FROM research_reports ORDER BY created_at DESC').all();
  return rows.map(parse);
}

export function reviewReport(reportId, status, documentId = null) {
  const res = getDb().prepare(`
    UPDATE research_reports SET status = ?, document_id = ?, reviewed_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(status, documentId, new Date().toISOString(), reportId);
  return res.changes > 0 ? getReport(reportId) : null;
}

export function deleteReport(reportId) {
  return getDb().prepare('DELETE FROM research_reports WHERE id = ?').run(reportId).changes > 0;
}
