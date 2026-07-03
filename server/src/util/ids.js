// Collision-resistant enough for a local, single-node app. Prefix keeps ids
// human-scannable in the DB (emp_…, doc_…, mtg_…).
export function id(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const now = () => new Date().toISOString();
