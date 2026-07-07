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

// Known real-executable locations relative to the shim's node_modules.
const PKG_EXE = {
  claude: ['@anthropic-ai/claude-code/bin/claude.exe'],
  codex: [
    '@openai/codex/bin/codex.exe',
    '@openai/codex/bin/codex-x86_64-pc-windows-msvc.exe',
    '@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe',
  ],
};

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
  for (const rel of PKG_EXE[base] || []) {
    const exe = path.join(path.dirname(shim), 'node_modules', ...rel.split('/'));
    if (fs.existsSync(exe)) {
      version = probe(exe);
      if (version) return { cmd: exe, version };
    }
  }
  return null;
}
