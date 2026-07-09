// Packaged-exe MarkItDown auto-setup (「點了 exe 也能用」).
//
// A source checkout uses `npm run setup:markitdown`; a double-clicked exe has
// no npm and no project folder. So on first boot the exe bootstraps itself,
// in the background, next to its own data:
//
//   1. find a system Python (py -3.12/-3.11/-3.13 launcher first — MarkItDown
//      0.1.6's optional deps want 3.11–3.13 on Windows — then bare python)
//   2. create <exe dir>/veemp-data/.venv
//   3. pip install markitdown[all] + pdfplumber into it
//   4. reset the probe cache → the very next upload converts PDFs
//
// No Python on the machine → status 'no-python' and the upload error tells the
// user exactly what to install; after they install Python, the NEXT launch of
// the exe completes everything automatically. Never throws; never blocks boot.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isPackaged, exeDir } from '../util/portable.js';
import { setSetupStatus } from './setupStatus.js';
import { probe, _resetProbeCache } from './markitdown.js';
import { config } from '../config.js';

const runQuiet = (cmd, args, timeoutMs = 60_000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
    (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

// Interpreter candidates, best-fit first (Windows py launcher pins a version).
const CANDIDATES = process.platform === 'win32'
  ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.13']], ['python', []], ['py', []]]
  : [['python3.12', []], ['python3.11', []], ['python3.13', []], ['python3', []], ['python', []]];

async function findSystemPython() {
  for (const [cmd, pre] of CANDIDATES) {
    const { err } = await runQuiet(cmd, [...pre, '--version'], 15_000);
    if (!err) return { cmd, pre };
  }
  return null;
}

/**
 * Ensure MarkItDown works in the packaged exe. Fire-and-forget from boot:
 * resolves quickly when already available; otherwise installs in the
 * background and updates setupStatus as it goes.
 */
export async function ensureMarkitdown() {
  if (!isPackaged() || config.ingest.disabled) return;
  try {
    if ((await probe()).available) { setSetupStatus('ready'); return; }

    const venvDir = path.join(exeDir(), 'veemp-data', '.venv');
    const venvPython = path.join(venvDir, 'Scripts', 'python.exe');

    const sys = await findSystemPython();
    if (!sys) {
      setSetupStatus('no-python');
      console.log('  [markitdown] 此電腦沒有 Python — PDF/DOCX 解析停用（TXT/MD/HTML 不受影響）。');
      console.log('  [markitdown] 到 https://www.python.org/ 安裝 3.11–3.13 後重啟本程式，即可自動完成設定。');
      return;
    }

    setSetupStatus('installing', '建立 Python 環境');
    console.log('  [markitdown] 首次設定：正在背景安裝 PDF/DOCX 解析元件（約 1–3 分鐘）…');
    if (!fs.existsSync(venvPython)) {
      const mk = await runQuiet(sys.cmd, [...sys.pre, '-m', 'venv', venvDir], 120_000);
      if (mk.err) throw new Error(`venv 建立失敗：${(mk.stderr || mk.err.message).slice(0, 200)}`);
    }

    setSetupStatus('installing', '安裝 markitdown 套件');
    const pip = await runQuiet(
      venvPython,
      ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', 'markitdown[all]==0.1.6', 'pdfplumber'],
      600_000, // real downloads — give it up to 10 minutes
    );
    if (pip.err) throw new Error(`pip 安裝失敗：${(pip.stderr || pip.err.message).slice(0, 300)}`);

    _resetProbeCache();
    const after = await probe({ refresh: true });
    if (after.available) {
      setSetupStatus('ready');
      console.log('  [markitdown] ✓ PDF/DOCX 解析已就緒。');
    } else {
      setSetupStatus('failed', after.error || 'probe still unavailable');
      console.warn('  [markitdown] 安裝完成但探測仍失敗：', after.error || '(unknown)');
    }
  } catch (err) {
    setSetupStatus('failed', String(err.message || err).slice(0, 300));
    console.warn(`  [markitdown] 自動設定失敗（不影響其他功能）：${err.message}`);
  }
}
