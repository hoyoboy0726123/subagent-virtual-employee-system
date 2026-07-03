// Entry point. Builds the app and listens; exports `app` for the smoke test.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { config, llmEnabled } from './config.js';
import { getRuntimeMode } from './services/settings.service.js';

const app = createApp();

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(config.port, () => {
    console.log(`\n  🧑‍💼 Virtual Employee System API on http://localhost:${config.port}`);
    console.log(`  Storage : SQLite (${config.dbFile})`);
    console.log(`  Runtime : ${getRuntimeMode()}`);
    console.log(`  LLM     : ${llmEnabled() ? `live (Google Gen AI · ${config.llm.model})` : 'off (deterministic engine)'}\n`);
  });
}
