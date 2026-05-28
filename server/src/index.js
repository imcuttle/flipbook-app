import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { log } from './lib/log.js';
import { initDb } from './db/index.js';
import { hydrateFromDisk } from './db/hydrate.js';

function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

async function main() {
  ensureDirs();
  await initDb();
  await hydrateFromDisk();
  const app = createApp();
  app.listen(config.port, config.host, () => {
    log.info(`Flipbook server listening on http://${config.host}:${config.port}`);
    log.info(`  data dir: ${config.dataDir}`);
    log.info(`  prompts:  ${config.promptsDir}`);
    log.info(`  codebuddy: ${config.enableCodebuddy ? 'enabled' : 'disabled (stub mode)'}`);
  });
}

main().catch((e) => {
  log.error('fatal startup error', e?.stack || e);
  process.exit(1);
});
