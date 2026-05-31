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
  // Portrait counterpart of imageSize, used when a canvas was created with
  // orientation='portrait' (e.g. a phone held upright). Landscape stays the
  // default for back-compat with every existing canvas.
  imageSizePortrait: process.env.IMAGE_SIZE_PORTRAIT || '1080x1920',
  // Comma-separated provider chain. First enabled provider wins; 'svg' is
  // always appended as the final fallback. Supported: codebuddy, openai,
  // nanobanana, seeddance, svg.
  imageProvider: process.env.IMAGE_PROVIDER || 'codebuddy',
  // For Phase 1/2 we run with stubs; Phase 3+ flips this on
  enableCodebuddy: process.env.ENABLE_CODEBUDDY === '1',
  // Apple Vision OCR pass after each image is generated. On by default
  // (it's free, fast, and only runs if a real PNG was produced). Set
  // ENABLE_OCR=0 to opt out.
  enableOcr: process.env.ENABLE_OCR !== '0',
  ocrTimeoutMs: Number(process.env.OCR_TIMEOUT_MS || 25_000),
  ocrMinConfidence: Number(process.env.OCR_MIN_CONFIDENCE || 0.4),
  ocrMaxSpans: Number(process.env.OCR_MAX_SPANS || 200),
};

// Map a canvas orientation to its image size string ("WxH"). Anything other
// than the literal 'portrait' (including undefined / legacy canvases) maps
// to the landscape default.
export function resolveImageSize(orientation) {
  return orientation === 'portrait' ? config.imageSizePortrait : config.imageSize;
}

// Parse a "WxH" size string into { width, height }. Falls back to 1920x1080
// when the input is malformed.
export function parseSize(size) {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size ?? '').trim());
  if (!m) return { width: 1920, height: 1080 };
  return { width: Number(m[1]), height: Number(m[2]) };
}
