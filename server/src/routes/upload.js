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

// Persist an in-memory upload (from multer) into the canvas's uploads/
// directory. Returns the absolute path.
export async function persistUpload(canvasId, basename, file) {
  const dir = paths.uploadDir(canvasId);
  await fs.mkdir(dir, { recursive: true });
  const ext = extForFile(file);
  const dest = paths.uploadPath(canvasId, `${basename}.${ext}`);
  await fs.writeFile(dest, file.buffer);
  return dest;
}
