import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { log } from './lib/log.js';
import { canvasRouter } from './routes/canvas.js';
import { clickRouter } from './routes/click.js';
import { eventsRouter } from './routes/events.js';
import { assetsRouter } from './routes/assets.js';
import { shareRouter } from './routes/share.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString(), codebuddy: config.enableCodebuddy });
  });

  app.use('/api/canvas', canvasRouter);
  app.use('/api/canvas', clickRouter);
  app.use('/api/canvas', eventsRouter);
  app.use('/api/canvas', assetsRouter);
  app.use('/api', shareRouter);

  // 404 for unmatched /api routes
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  // Production: serve built web assets if they exist
  if (fs.existsSync(config.webDistDir)) {
    app.use(express.static(config.webDistDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.webDistDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send(
        'Flipbook server running. Web build not present — run `npm run dev:web` for the dev server, or `npm run build` to produce web/dist.\n'
      );
    });
  }

  app.use((err, _req, res, _next) => {
    log.error('unhandled', err?.stack || err);
    res.status(500).json({ error: 'internal_error', message: err?.message });
  });

  return app;
}
