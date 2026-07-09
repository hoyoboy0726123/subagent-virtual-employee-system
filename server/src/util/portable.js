// Packaged-exe (Node SEA) support. When the app runs as a single executable
// (built by scripts/build-exe.mjs) there is no source tree on disk, so:
//   • the SQLite file lives NEXT TO the exe (./veemp-data/app.db) — portable,
//     easy to back up, survives moving the exe;
//   • the built client is served from an EMBEDDED asset map instead of
//     express.static;
//   • the MarkItDown Python helper is embedded too and extracted into
//     ./veemp-data/ at first use, so PDF/DOCX parsing works from the exe once
//     Python is present (ingest/autoSetup.js even installs the venv itself).
// The embedded payload lives in server/src/generated/client-assets.mjs — a
// null stub in the repo, overwritten with { client, helperPy } during the exe
// build and restored afterwards. In a source checkout everything here is
// inert: isPackaged() is false and the payload is null.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import embedded from '../generated/client-assets.mjs';

const require_ = createRequire(import.meta.url);

let sea = null;
try { sea = require_('node:sea'); } catch { /* older node / not available */ }

/** True when running from a Single Executable Application build. */
export function isPackaged() {
  try { return Boolean(sea?.isSea?.()); } catch { return false; }
}

/** Directory the exe lives in (only meaningful when packaged). */
export function exeDir() {
  return path.dirname(process.execPath);
}

/** Embedded client asset map ({ '/index.html': {type, b64}, … }) or null. */
export function getEmbeddedAssets() {
  return embedded?.client || null;
}

/**
 * Extract the embedded MarkItDown helper script to ./veemp-data/ and return
 * its path (packaged mode only; null otherwise). Overwritten on every boot so
 * an updated exe never runs a stale helper.
 */
export function extractHelperPy() {
  if (!embedded?.helperPy) return null;
  const dir = path.join(exeDir(), 'veemp-data');
  const target = path.join(dir, 'markitdown_helper.py');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, embedded.helperPy, 'utf8');
    return target;
  } catch {
    return null;
  }
}
