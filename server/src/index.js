// Entry point. Builds the app and listens; exports `app` for the smoke test.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { config } from './config.js';
import { llmEnabled, activeModelInfo } from './reasoning/llm.js';
import { isPackaged } from './util/portable.js';
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

// Async IIFE instead of top-level await: the exe build bundles to CommonJS
// (Node SEA requires a CJS entry), and CJS has no TLA.
if (isMain) (async () => {
  await seedIfFresh();
  // Packaged exe: bootstrap PDF/DOCX parsing in the background (finds Python,
  // builds a venv beside the exe, pip-installs MarkItDown). Fire-and-forget —
  // boot never waits, failures degrade to TXT/MD/HTML-only upload.
  if (isPackaged()) {
    import('./ingest/autoSetup.js')
      .then(({ ensureMarkitdown }) => ensureMarkitdown())
      .catch(() => { /* optional capability — never block boot */ });
  }
  app.listen(config.port, () => {
    const url = `http://localhost:${config.port}`;
    console.log(`\n  🧑‍💼 Virtual Employee System API on ${url}`);
    console.log(`  Storage : SQLite (${config.dbFile})`);
    console.log('  Runtime : standalone（內建多代理）');
    console.log(`  LLM     : ${llmEnabled() ? `live (${activeModelInfo().label})` : 'off (deterministic engine)'}\n`);
    // Packaged exe: open the browser for the double-click user (best-effort).
    if (isPackaged() && process.platform === 'win32') {
      try { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
    }
  });
})();
