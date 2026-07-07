// Per-key serialization (Phase 20 concurrency hardening).
//
// Meetings and 1-on-1 dialogues mutate a single JSON row across a long `await`
// (an LLM turn), so two concurrent requests on the SAME resource each read the
// old transcript and the later writer clobbers the earlier one — lost turns,
// duplicated conclude/close artifacts. This runs operations keyed by resource
// id strictly one-at-a-time (FIFO), while different resources still run
// concurrently. In-process only, which matches this single-node app.
const chains = new Map();

/**
 * Run `fn` after any in-flight operation for `key` completes; concurrent calls
 * for the same key queue behind each other. Returns fn's result/rejection.
 */
export function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  // Swallow the predecessor's result/error so one failure can't break the chain.
  const run = prev.then(() => fn(), () => fn());
  // Keep the chain tail current; clean up the map when this is the last link.
  const tail = run.catch(() => {}).finally(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  chains.set(key, tail);
  return run;
}
