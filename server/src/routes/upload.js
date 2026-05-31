// Multer configuration for image uploads — used by canvas creation
// (POST /api/canvas/upload) and click drilldown (POST /api/canvas/:id/click/upload).
//
// We use memory storage and persist the file ourselves AFTER the canvas
// exists (canvas creation flow needs to mint the canvasId first). For
// click uploads we save directly into the existing canvas's uploads/ dir.
//
// Limits chosen to be permissive but not absurd:
//   - Max 8 MB per file (typical phone screenshot is ~2-4 MB).
//   - Only image/* MIME types.
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { paths } from '../store/paths.js';

const MAX_BYTES = 8 * 1024 * 1024;

export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('only image uploads are accepted'));
  },
});

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function extForFile(file) {
  const fromMime = EXT_BY_MIME[file?.mimetype];
  if (fromMime) return fromMime;
  // Fallback to original filename's extension if recognisable.
  const orig = (file?.originalname ?? '').toLowerCase();
  const ext = path.extname(orig).slice(1);
  return ext && /^(png|jpe?g|webp|gif)$/.test(ext) ? ext.replace('jpeg', 'jpg') : 'png';
}

// Longest-edge cap for persisted seed images. A user can upload up to
// MAX_BYTES (8 MB) of phone-camera JPEG at e.g. 4032×3024. That seed is
// later referenced via codebuddy's `@<path>` syntax by describeSeed,
// planner, AND callImageGen — and codebuddy base64-encodes the image into
// the session then ECHOES it back in --output-format json stdout, which
// balloons stdout to MBs of base64 and makes JSON parsing fail every time
// (same root cause as the click-marker echo bug). 1536px is still plenty
// for both vision understanding and image-edit composition fidelity while
// keeping the file (and its base64 echo) small.
const SEED_MAX_EDGE = 1536;

// Best-effort downscale of an oversized image buffer. Returns the resized
// buffer + the extension to persist (oversized images are normalised to
// JPEG for size; small images keep their original ext/buffer). Falls back
// to the original buffer if sharp is unavailable or the image can't be
// processed — persistence must never fail just because resizing did.
async function maybeDownscale(buffer, ext) {
  let sharp;
  try {
    const mod = await import('sharp');
    sharp = mod.default ?? mod;
  } catch {
    return { buffer, ext }; // sharp not installed — keep original
  }
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return { buffer, ext };
    const longest = Math.max(meta.width, meta.height);
    if (longest <= SEED_MAX_EDGE) return { buffer, ext }; // already small enough
    const scale = SEED_MAX_EDGE / longest;
    const out = await sharp(buffer)
      .resize(
        Math.round(meta.width * scale),
        Math.round(meta.height * scale),
        { fit: 'inside' },
      )
      // Normalise to JPEG: oversized uploads are photos, and JPEG keeps the
      // downscaled seed an order of magnitude smaller than re-encoded PNG.
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: out, ext: 'jpg' };
  } catch {
    return { buffer, ext };
  }
}

// Persist an in-memory upload (from multer) into the canvas's uploads/
// directory. Returns the absolute path. Oversized images are downscaled
// first (see maybeDownscale / SEED_MAX_EDGE).
export async function persistUpload(canvasId, basename, file) {
  const dir = paths.uploadDir(canvasId);
  await fs.mkdir(dir, { recursive: true });
  const { buffer, ext } = await maybeDownscale(file.buffer, extForFile(file));
  const dest = paths.uploadPath(canvasId, `${basename}.${ext}`);
  await fs.writeFile(dest, buffer);
  return dest;
}
