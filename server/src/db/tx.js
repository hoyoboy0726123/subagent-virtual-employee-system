// Transaction helper for node:sqlite's DatabaseSync (which, unlike better-sqlite3,
// has no `db.transaction()` wrapper). Runs `fn` inside BEGIN/COMMIT and rolls
// back on any thrown error, returning fn's result. Not re-entrant — callers must
// not nest withTx calls on the same connection.
export function withTx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw err;
  }
}
