import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  // server/data/canvases/<id>/...
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),
  // app/prompts/*.md
  promptsDir: process.env.PROMPTS_DIR || path.resolve(__dirname, '..', '..', 'prompts'),
  // app/web/dist (production)
  webDistDir: process.env.WEB_DIST_DIR || path.resolve(__dirname, '..', '..', 'web', 'dist'),
  codebuddyBin: process.env.CODEBUDDY_BIN || 'codebuddy',
  maxParallelCodebuddy: Number(process.env.MAX_PARALLEL_CODEBUDDY || 2),
  plannerTimeoutMs: Number(process.env.PLANNER_TIMEOUT_MS || 90_000),
  imageTimeoutMs: Number(process.env.IMAGE_TIMEOUT_MS || 180_000),
  imageSize: process.env.IMAGE_SIZE || '1920x1080',
  // Comma-separated provider chain. First enabled provider wins; 'svg' is
  // always appended as the final fallback. Supported: codebuddy, openai,
  // nanobanana, seeddance, svg.
  imageProvider: process.env.IMAGE_PROVIDER || 'codebuddy',
  // For Phase 1/2 we run with stubs; Phase 3+ flips this on
  enableCodebuddy: process.env.ENABLE_CODEBUDDY === '1',
};
