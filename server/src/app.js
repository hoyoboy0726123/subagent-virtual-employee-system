// Express app assembly. Mounts the thin routers, serves the built client in
// production, and installs a single error handler that maps HttpError → status.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getDb } from './db/connection.js';
import { getEmbeddedAssets } from './util/portable.js';
import { healthRouter } from './routes/health.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { employeesRouter } from './routes/employees.routes.js';
import { knowledgeRouter } from './routes/knowledge.routes.js';
import { meetingsRouter } from './routes/meetings.routes.js';
import { goalsRouter } from './routes/goals.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { researchRouter } from './routes/research.routes.js';
import { dialoguesRouter } from './routes/dialogues.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  // Open (and migrate) the database up front so the first request is fast and
  // any schema problem surfaces at boot rather than mid-request.
  getDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '12mb' })); // headroom for pasted/dropped images (base64)

  app.use('/api', healthRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', settingsRouter);
  app.use('/api', employeesRouter);
  app.use('/api', knowledgeRouter);
  app.use('/api', meetingsRouter);
  app.use('/api', goalsRouter);
  app.use('/api', researchRouter);
  app.use('/api', dialoguesRouter);

  // Serve the built client. Packaged exe (Node SEA): from the embedded asset
  // map — there is no dist folder on disk. Source checkout: express.static.
  const embedded = getEmbeddedAssets();
  if (embedded) {
    app.get(/^\/(?!api\/).*/, (req, res) => {
      const key = req.path === '/' ? '/index.html' : req.path;
      const asset = embedded[key] || embedded['/index.html']; // SPA fallback
      res.type(asset.type).send(Buffer.from(asset.b64, 'base64'));
    });
  } else {
    const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    }
  }

  // Unknown API route → 404 JSON.
  app.use('/api', (_req, res) => res.status(404).json({ error: '找不到資源' }));

  // Central error handler. Services throw HttpError (with .status); anything
  // else is a 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: err.message || '內部錯誤' });
  });

  return app;
}
