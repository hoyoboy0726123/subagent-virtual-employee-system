// Packaged-exe (Node SEA) support. When the app runs as a single executable
// (built by scripts/build-exe.mjs) there is no source tree on disk, so:
//   • the SQLite file lives NEXT TO the exe (./veemp-data/app.db) — portable,
//     easy to back up, survives moving the exe;
//   • the built client is served from an EMBEDDED asset map instead of
//     express.static (see server/src/generated/client-assets.mjs — a null stub
//     in the repo, overwritten with real content during the exe build).
// In a normal source checkout everything here is inert: isPackaged() is false
// and the embedded assets are null.
import path from 'node:path';
import { createRequire } from 'node:module';
import embeddedAssets from '../generated/client-assets.mjs';

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
  return embeddedAssets;
}
