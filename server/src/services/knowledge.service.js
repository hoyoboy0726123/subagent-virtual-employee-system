// Service: knowledge base (documents + retrieval).
import * as docs from '../storage/knowledge.repo.js';
import { getEmployee } from '../storage/employees.repo.js';
import { search as retrievalSearch } from '../storage/retrieval.js';
import { badRequest, notFound } from '../util/http.js';

export function listForEmployee(employeeId) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  return docs.listDocuments(employeeId);
}

export function addDocument(employeeId, data = {}) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  if (!data.content) throw badRequest('內容為必填');
  return docs.insertDocument(employeeId, data);
}

export function removeDocument(documentId) {
  if (!docs.deleteDocument(documentId)) throw notFound('找不到該文件');
  return { ok: true };
}

/**
 * Keyword/FTS search over the knowledge base, optionally scoped to one or more
 * employees. Powers the retrieval demo endpoint and (indirectly) the runtime.
 */
export function search({ query, employeeIds, limit } = {}) {
  if (!query || !String(query).trim()) throw badRequest('查詢字串為必填');
  const ids = Array.isArray(employeeIds)
    ? employeeIds
    : (employeeIds ? String(employeeIds).split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  return retrievalSearch({ query, employeeIds: ids, limit: limit ? Number(limit) : undefined });
}
