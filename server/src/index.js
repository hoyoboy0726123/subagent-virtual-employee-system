// Entry point. Builds the app and listens; exports `app` for the smoke test.
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { config } from './config.js';
import { llmEnabled, activeModelInfo } from './reasoning/llm.js';
import { isPackaged, exeDir } from './util/portable.js';
import { listEmployees } from './storage/employees.repo.js';
import { getSetting, setSetting } from './storage/settings.repo.js';

const app = createApp();

export { app };

// First-boot seeding: a brand-new database gets the default team (9 personas +
// background knowledge) automatically — essential for the packaged exe, where
// the user never runs `npm run seed`. Guarded by a settings flag so a roster
// the user emptied ON PURPOSE is never re-seeded behind their back.
async function seedIfFresh() {
  if (getSetting('seeded')) return;
  if (listEmployees().length > 0) { setSetting('seeded', '1'); return; } // pre-flag DB
  console.log('  首次啟動：正在建立預設團隊（9 位 AI 員工＋背景知識）…');
  const { seed } = await import('./db/seed.js');
  await seed();
  setSetting('seeded', '1');
}

// Packaged exe: always the main entry. Source checkout: same argv check as
// before, so importing `app` from tests never starts a listener.
const isMain = isPackaged()
  || (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

// Bind the first free port at/above `startPort`. A double-clicked exe must NOT
// crash just because 3001 is already taken (another copy, a dev server, …) —
// that was surfacing as the console window flashing shut.
function listenWithFallback(startPort, tries = 15) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const attempt = () => {
      const server = app.listen(port);
      server.once('listening', () => resolve({ server, port }));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < startPort + tries) { port += 1; attempt(); }
        else reject(err);
      });
    };
    attempt();
  });
}

// A windowless exe has no console — record fatal boot errors to a file next to
// it so a user can still find out why nothing happened.
function logFatal(err) {
  if (!isPackaged()) return;
  try {
    const dir = path.join(exeDir(), 'veemp-data');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'error.log'), `[${new Date().toISOString()}] 啟動失敗：${err?.stack || err?.message || err}\n`);
  } catch { /* nothing else we can do */ }
}

// Keep a double-clicked CONSOLE window open on a fatal error so the user can
// read it. Windowless exe (no TTY) already logged to file — just exit.
function pauseThenExit(code) {
  if (!isPackaged() || !process.stdin.isTTY) { process.exit(code); return; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n按 Enter 鍵關閉此視窗…', () => { rl.close(); process.exit(code); });
}

// Async IIFE instead of top-level await: the exe build bundles to CommonJS
// (Node SEA requires a CJS entry), and CJS has no TLA.
if (isMain) (async () => {
  try {
    await seedIfFresh();
    // Packaged exe: bootstrap PDF/DOCX parsing in the background (finds Python,
    // builds a venv beside the exe, pip-installs MarkItDown). Fire-and-forget —
    // boot never waits, failures degrade to TXT/MD/HTML-only upload.
    if (isPackaged()) {
      import('./ingest/autoSetup.js')
        .then(({ ensureMarkitdown }) => ensureMarkitdown())
        .catch(() => { /* optional capability — never block boot */ });
    }
    const { port } = await listenWithFallback(config.port);
    const url = `http://localhost:${port}`;
    console.log(`\n  🧑‍💼 Virtual Employee System API on ${url}`);
    console.log(`  Storage : SQLite (${config.dbFile})`);
    console.log('  Runtime : standalone（內建多代理）');
    console.log(`  LLM     : ${llmEnabled() ? `live (${activeModelInfo().label})` : 'off (deterministic engine)'}`);
    if (port !== config.port) console.log(`  （埠 ${config.port} 已被佔用，改用 ${port}）`);
    console.log('');
    // Packaged exe: open the browser for the double-click user. windowsHide so
    // the launcher cmd never flashes (the exe itself is windowless).
    if (isPackaged() && process.platform === 'win32') {
      try { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* ignore */ }
    }
  } catch (err) {
    logFatal(err);
    console.error('\n  ✗ 啟動失敗：', err?.message || err);
    console.error('  請截圖上方訊息回報（或見 veemp-data\\error.log）。');
    pauseThenExit(1);
  }
})();
