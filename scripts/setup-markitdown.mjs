// Cross-platform MarkItDown installer.
//
// Creates a project-local `.venv` and installs MarkItDown + pdfplumber into it,
// so PDF/DOCX/PPTX/XLSX/CSV uploads convert to Markdown. Optional — text
// formats ingest without it. Handles Windows / macOS / Linux venv layouts.
//
// Usage: npm run setup:markitdown
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const VENV = '.venv';
// Drive pip through `python -m pip`, never the pip.exe shim: modern pip (26+)
// refuses to modify itself via the shim ("To modify pip, please run:
// python -m pip …"), which used to break `--upgrade pip` on fresh venvs.
const venvPython = path.join(VENV, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

// MarkItDown 0.1.6 needs Python >=3.8,<3.13 for its optional deps on Windows;
// 3.13 works on POSIX. Try a few interpreters, newest-compatible first.
const CANDIDATES = isWin
  ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.13']], ['python', []]]
  : [['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];

function probe(cmd, pre) {
  try {
    execFileSync(cmd, [...pre, '--version'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const found = CANDIDATES.find(([cmd, pre]) => probe(cmd, pre));
if (!found) {
  console.error('✗ 找不到可用的 Python（需要 3.11–3.13）。請先安裝 Python 後再試。');
  console.error('  MarkItDown 是選用功能：不裝也能上傳 TXT/MD/HTML，只有 PDF/DOCX 等需要它。');
  process.exit(1);
}

const [cmd, pre] = found;
console.log(`→ 使用 ${cmd} ${pre.join(' ')} 建立虛擬環境 ${VENV} …`);
try {
  if (!fs.existsSync(VENV)) {
    execFileSync(cmd, [...pre, '-m', 'venv', VENV], { stdio: 'inherit' });
  }
  console.log('→ 安裝 markitdown[all]==0.1.6 + pdfplumber …');
  // Upgrading pip is a nice-to-have, not a requirement — never fail the whole
  // setup over it (some environments pin/lock pip).
  try {
    execFileSync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
  } catch { console.log('  （略過 pip 自我升級，繼續安裝套件）'); }
  execFileSync(venvPython, ['-m', 'pip', 'install', 'markitdown[all]==0.1.6', 'pdfplumber'], { stdio: 'inherit' });
  console.log('\n✓ 完成。重啟伺服器後即可上傳 PDF / DOCX / PPTX / XLSX / CSV。');
} catch (err) {
  console.error(`✗ 安裝失敗：${err.message}`);
  process.exit(1);
}
