// Shared CLI runner for the subscription providers (claude-cli / codex-cli).
//
// Spawns a CLI, feeds `prompt` on stdin, resolves its stdout (or null). Two
// hazards it guards against:
//   1. stdin 'error' (EPIPE/EOF if the CLI exits before draining a big prompt)
//      would otherwise surface as an async stream error and crash the server —
//      an 'error' handler swallows it.
//   2. A HUNG PROCESS TREE: execFile's `timeout` only SIGTERMs the DIRECT child,
//      but claude/codex spawn grandchildren (MCP / sandbox helpers) that can
//      keep the stdout pipe open, so execFile's 'close' callback never fires and
//      the caller's semaphore slot leaks forever (after maxConcurrent leaks the
//      whole provider deadlocks). A self-timeout force-resolves null and kills
//      the entire tree (POSIX process group / Windows `taskkill /T`).
import { execFile } from 'node:child_process';

export function runCli(cmd, args, { env, timeoutMs = 300_000, graceMs = 10_000, maxBuffer = 32 * 1024 * 1024, execFileImpl = execFile } = {}, prompt = '') {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(guard); resolve(v); } };
    const posix = process.platform !== 'win32';

    const child = execFileImpl(
      cmd,
      args,
      { env, timeout: timeoutMs, maxBuffer, windowsHide: true, ...(posix ? { detached: true } : {}) },
      (err, out) => done(err && !out ? null : String(out || '')),
    );

    const killTree = () => {
      if (!child?.pid) return;
      if (posix) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
      } else {
        execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], () => {});
      }
    };

    // Grace beyond execFile's own timeout: the native timeout is the first line,
    // this backstop only fires if the tree refused to die.
    const guard = setTimeout(() => { killTree(); done(null); }, timeoutMs + graceMs);
    guard.unref?.();

    child?.stdin?.on('error', () => {}); // see hazard #1
    child?.stdin?.end(prompt);
  });
}
