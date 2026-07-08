// Windows-safe CLI resolution (Phase 18).
//
// npm installs `claude` / `codex` as `.cmd` shims, which `execFile` cannot run
// without a shell — and shelling out would wreck the quoting of args that
// carry whole persona prompts. Both packages ship a REAL executable inside
// their package directory, so on Windows we locate the shim with `where`,
// then probe the packaged .exe next to it and spawn that directly.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// Known real-executable locations relative to the shim's node_modules. These
// are checked first (fast path); when a package reshuffles its layout (codex
// did in 0.142.x, moving the exe into a platform sub-package), the bounded
// recursive search below still finds it.
const PKG_EXE = {
  claude: ['@anthropic-ai/claude-code/bin/claude.exe'],
  codex: [
    // 0.142.x layout: platform sub-package
    '@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
    // older layouts
    '@openai/codex/bin/codex.exe',
    '@openai/codex/bin/codex-x86_64-pc-windows-msvc.exe',
    '@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe',
  ],
};

// Package roots to sweep when the known paths miss (layout drift).
const PKG_ROOT = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
};

// Bounded recursive search for `${name}.exe` under a package dir. Package trees
// are small (a few hundred entries); depth-capped and best-effort so a weird
// layout can never hang startup. Helper exes (rg.exe, *-runner.exe…) don't
// match because we require the EXACT basename.
function findExeUnder(dir, exeName, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === exeName) return p;
    if (e.isDirectory()) {
      const hit = findExeUnder(p, exeName, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function probe(cmd) {
  try {
    return String(execFileSync(cmd, ['--version'], {
      timeout: 15_000, windowsHide: true, encoding: 'utf8',
    })).trim() || 'ok';
  } catch {
    return null;
  }
}

/**
 * Resolve a CLI name/path to something `execFile` can spawn WITHOUT a shell.
 * @returns {{cmd: string, version: string}|null}
 */
export function resolveCli(cli) {
  let version = probe(cli);
  if (version) return { cmd: cli, version };
  if (process.platform !== 'win32') return null;

  version = probe(`${cli}.exe`);
  if (version) return { cmd: `${cli}.exe`, version };

  // Find the npm .cmd shim, then the real exe inside the package it wraps.
  let whereOut = '';
  try {
    whereOut = String(execFileSync('where', [cli], {
      timeout: 10_000, windowsHide: true, encoding: 'utf8',
    }));
  } catch {
    return null;
  }
  const shim = whereOut.split(/\r?\n/).map((s) => s.trim())
    .find((l) => l.toLowerCase().endsWith('.cmd'));
  if (!shim) return null;

  const base = path.basename(cli).replace(/\.(cmd|exe)$/i, '');
  const nodeModules = path.join(path.dirname(shim), 'node_modules');
  for (const rel of PKG_EXE[base] || []) {
    const exe = path.join(nodeModules, ...rel.split('/'));
    if (fs.existsSync(exe)) {
      version = probe(exe);
      if (version) return { cmd: exe, version };
    }
  }

  // Layout drift fallback: sweep the package tree for the exact `${base}.exe`
  // (codex 0.142.x moved it into a platform sub-package unannounced).
  const root = PKG_ROOT[base];
  if (root) {
    const hit = findExeUnder(path.join(nodeModules, ...root.split('/')), `${base}.exe`);
    if (hit) {
      version = probe(hit);
      if (version) return { cmd: hit, version };
    }
  }
  return null;
}
