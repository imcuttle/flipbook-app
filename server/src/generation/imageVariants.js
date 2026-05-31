// Derive progressive-loading image variants from a finalized node PNG.
//
// For each real PNG we produce three JPEG variants alongside it in the
// canvas's images/ dir:
//   - <hash>.blur.jpg   — tiny (~32px) heavily-blurred LQIP placeholder
//                         (~1-2 KB). Shown instantly while the real image
//                         streams in, then cross-faded out. Used on both
//                         the gallery cards and the canvas first-paint.
//   - <hash>.thumb.jpg  — small (~480px longest edge). Gallery cards: the
//                         clear image cross-faded in over the blur.
//   - <hash>.medium.jpg — medium (~1280px longest edge). Canvas first-paint;
//                         the full-resolution PNG is swapped in afterwards
//                         for click precision / OCR alignment.
//
// Best-effort and non-blocking: callers fire-and-forget. If sharp is missing
// or a step fails, we skip silently — the frontend falls back to the original
// PNG (variants are an optimisation, never a correctness requirement).
import { paths } from '../store/paths.js';
import { log } from '../lib/log.js';

let sharpModule = null;
let sharpProbed = false;
async function getSharp() {
  if (sharpProbed) return sharpModule;
  sharpProbed = true;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default ?? mod;
  } catch (e) {
    log.warn(`sharp not available — image variants disabled: ${e?.message}`);
    sharpModule = null;
  }
  return sharpModule;
}

const VARIANTS = [
  // name      longest edge   jpeg quality   extra
  { name: 'blur', edge: 32, quality: 50, blur: true },
  { name: 'thumb', edge: 480, quality: 72 },
  { name: 'medium', edge: 1280, quality: 80 },
];

/**
 * Generate blur + thumb + medium JPEG variants for a node's PNG.
 * @param {string} canvasId
 * @param {string} hash
 * @returns {Promise<{ ok: boolean, variants: string[] }>} the variant names
 *   actually written (e.g. ['blur','thumb','medium']).
 */
export async function generateImageVariants(canvasId, hash) {
  const sharp = await getSharp();
  if (!sharp) return { ok: false, variants: [] };

  const srcPng = paths.imagePath(canvasId, hash, 'png');
  const written = [];
  for (const v of VARIANTS) {
    const outPath = paths.imagePath(canvasId, hash, `${v.name}.jpg`);
    try {
      let pipe = sharp(srcPng).resize(v.edge, v.edge, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      if (v.blur) pipe = pipe.blur(8); // strong gaussian for the LQIP
      await pipe.jpeg({ quality: v.quality, mozjpeg: true }).toFile(outPath);
      written.push(v.name);
    } catch (e) {
      // One bad variant shouldn't abort the rest; log once and continue.
      log.warn(`[variants] ${canvasId}/${hash} ${v.name} failed: ${e?.message}`);
    }
  }
  return { ok: written.length > 0, variants: written };
}

/**
 * Fast image-dimensions probe via sharp metadata (no decode of pixel data).
 * Used to record image_w/image_h on the node up-front so the first paint
 * letterboxes correctly, decoupled from the (now async) OCR pass which used
 * to be the dimensions source.
 * @returns {Promise<{ width: number, height: number } | null>}
 */
export async function probeImageSize(canvasId, hash) {
  const sharp = await getSharp();
  if (!sharp) return null;
  try {
    const m = await sharp(paths.imagePath(canvasId, hash, 'png')).metadata();
    if (m.width && m.height) return { width: m.width, height: m.height };
  } catch { /* fall through */ }
  return null;
}
