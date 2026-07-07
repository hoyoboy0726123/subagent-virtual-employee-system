// Node ↔ MarkItDown bridge.
//
// The ONLY place that shells out to Python. It drives
// `ingest/markitdown_helper.py` with `execFile` (never a shell, no interpolation)
// to convert a single uploaded file into canonical Markdown. MarkItDown is an
// optional enhancement — when no Python interpreter with the package is
// reachable, `probe()` reports `available: false` and the extractor
// (ingest/extract.js) falls back to a pure-JS path. This keeps the product
// standalone-first, exactly like the optional live LLM.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(__dirname, 'markitdown_helper.py');
// server/src/ingest → project root is three levels up.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Candidate interpreters, most-specific first. An explicit env override wins;
// then a project-local virtualenv (the documented setup); then a bare python3.
function candidatePythons() {
  const list = [];
  if (config.ingest.python) list.push(config.ingest.python);
  const venvPython = path.join(
    PROJECT_ROOT,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  if (fs.existsSync(venvPython)) list.push(venvPython);
  list.push('python3', 'python');
  // De-dupe while preserving order.
  return [...new Set(list)];
}

function run(python, args, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    execFile(
      python,
      [HELPER, ...args],
      {
        timeout: timeoutMs || 120_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        // Force Python into UTF-8 mode. On Windows the default stdio/file
        // encoding is the legacy code page (cp950/charmap), which blows up
        // ('charmap' codec can't encode …) as soon as a document contains
        // Chinese — both when MarkItDown reads text files and when the helper
        // prints its JSON to stdout.
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ spawnError: err, stderr: String(stderr || '') });
          return;
        }
        try {
          resolve({ json: JSON.parse(String(stdout).trim()) });
        } catch {
          resolve({ spawnError: err || new Error('bad helper output'), stderr: String(stdout || stderr || '') });
        }
      },
    );
  });
}

let probeCache = null;

/**
 * Probe MarkItDown availability. Result is cached for the process lifetime
 * (interpreters don't appear/disappear mid-run). Returns
 * `{ available, python, version }`.
 */
export async function probe({ refresh = false } = {}) {
  if (config.ingest.disabled) return { available: false, python: null, version: null, disabled: true };
  if (probeCache && !refresh) return probeCache;
  for (const python of candidatePythons()) {
    const { json, spawnError } = await run(python, ['--probe'], { timeoutMs: 15_000 });
    if (spawnError) continue; // interpreter missing / not runnable → try next
    if (json && json.available) {
      probeCache = { available: true, python, version: json.version || null };
      return probeCache;
    }
    // Python ran but markitdown wasn't importable there — keep looking, but
    // remember we at least found a working interpreter.
    if (json && !probeCache) probeCache = { available: false, python, version: null, error: json.error };
  }
  probeCache = probeCache || { available: false, python: null, version: null };
  return probeCache;
}

/**
 * Convert a local file to canonical Markdown via MarkItDown.
 * Resolves `{ ok: true, markdown, title, version }` on success, or
 * `{ ok: false, error }` when MarkItDown is unreachable or the conversion fails.
 * Never throws.
 */
export async function convert(filePath, { timeoutSec } = {}) {
  const info = await probe();
  if (!info.available || !info.python) {
    return { ok: false, error: 'MarkItDown 尚未安裝（找不到含 markitdown 套件的 Python）。' };
  }
  const timeoutMs = (timeoutSec || config.ingest.timeoutSec) * 1000;
  const { json, spawnError, stderr } = await run(info.python, ['--convert', filePath], { timeoutMs });
  if (spawnError) {
    const reason = /timed out|ETIMEDOUT/i.test(String(spawnError.message || '') + stderr)
      ? 'MarkItDown 轉換逾時。'
      : `MarkItDown 執行失敗：${(stderr || spawnError.message || '').slice(0, 300)}`;
    return { ok: false, error: reason };
  }
  if (!json || !json.ok) {
    return { ok: false, error: (json && json.error) || 'MarkItDown 轉換失敗。' };
  }
  return { ok: true, markdown: json.markdown || '', title: json.title || null, version: json.version || null };
}

// Test seam: let the smoke test reset the cached probe between scenarios.
export function _resetProbeCache() {
  probeCache = null;
}
