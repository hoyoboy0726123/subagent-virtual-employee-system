// Service: employees. Business logic (validation, profile generation, ideation)
// lives here; the route layer just adapts HTTP to these calls.
import * as repo from '../storage/employees.repo.js';
import { listDocuments } from '../storage/knowledge.repo.js';
import * as engine from '../reasoning/engine.js';
import { complete, llmEnabled } from '../reasoning/llm.js';
import { badRequest, notFound } from '../util/http.js';

export function list() {
  return repo.listEmployees();
}

// Employee detail includes their knowledge documents (backward-compatible
// `knowledge` field the existing client reads).
export function getWithKnowledge(id) {
  const emp = repo.getEmployee(id);
  if (!emp) throw notFound('找不到該員工');
  return { ...emp, knowledge: listDocuments(id) };
}

export function create(input = {}) {
  if (!input.name || !input.roleTitle) {
    throw badRequest('姓名與職稱為必填');
  }
  const profile = input.profile || engine.generateProfile(input);
  return repo.insertEmployee({ ...input, profile });
}

export function update(id, patch = {}) {
  const updated = repo.updateEmployee(id, patch);
  if (!updated) throw notFound('找不到該員工');
  return updated;
}

export function remove(id) {
  if (!repo.deleteEmployee(id)) throw notFound('找不到該員工');
  return { ok: true };
}

export function generateProfileFromFields(input = {}) {
  return { profile: engine.generateProfile(input) };
}

export async function ideate(description = '') {
  const draft = engine.ideateRole(description);
  if (llmEnabled()) {
    const text = await complete(
      '你是一位人資助理，負責草擬虛擬員工的個人檔案。請務必以繁體中文回覆，僅提供生動的兩段式背景描述。',
      `請為以下描述的員工草擬背景：${description}。職稱：${draft.roleTitle}。專長：${draft.expertise.join('、')}。`,
    );
    if (text) draft.profile = text.trim();
  }
  return draft;
}
