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
  if (!emp) throw notFound('employee not found');
  return { ...emp, knowledge: listDocuments(id) };
}

export function create(input = {}) {
  if (!input.name || !input.roleTitle) {
    throw badRequest('name and roleTitle are required');
  }
  const profile = input.profile || engine.generateProfile(input);
  return repo.insertEmployee({ ...input, profile });
}

export function update(id, patch = {}) {
  const updated = repo.updateEmployee(id, patch);
  if (!updated) throw notFound('employee not found');
  return updated;
}

export function remove(id) {
  if (!repo.deleteEmployee(id)) throw notFound('employee not found');
  return { ok: true };
}

export function generateProfileFromFields(input = {}) {
  return { profile: engine.generateProfile(input) };
}

export async function ideate(description = '') {
  const draft = engine.ideateRole(description);
  if (llmEnabled()) {
    const text = await complete(
      'You are an HR assistant that drafts a virtual employee profile. Reply with a vivid 2-paragraph background only.',
      `Draft a background for an employee described as: ${description}. Role: ${draft.roleTitle}. Expertise: ${draft.expertise.join(', ')}.`,
    );
    if (text) draft.profile = text.trim();
  }
  return draft;
}
