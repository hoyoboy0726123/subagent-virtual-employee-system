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
const venvPip = path.join(VENV, isWin ? 'Scripts' : 'bin', isWin ? 'pip.exe' : 'pip');

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
  execFileSync(venvPip, ['install', '--upgrade', 'pip'], { stdio: 'inherit' });
  execFileSync(venvPip, ['install', 'markitdown[all]==0.1.6', 'pdfplumber'], { stdio: 'inherit' });
  console.log('\n✓ 完成。重啟伺服器後即可上傳 PDF / DOCX / PPTX / XLSX / CSV。');
} catch (err) {
  console.error(`✗ 安裝失敗：${err.message}`);
  process.exit(1);
}
