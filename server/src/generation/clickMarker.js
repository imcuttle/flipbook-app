// Render a visible click marker on a copy of the parent image.
//
// Two purposes:
//   1. Debug artifact — the marked image is written to /tmp/flipbook-click-
//      <jobId>.png so a human can post-mortem why the click-label LLM
//      picked the wrong subject (open the file, inspect what's actually
//      under the marker).
//   2. Future vision-model input — when we wire codebuddy's image-input
//      capability in, this is the file we'll pass alongside the prompt.
//
// Marker design: red 36px-radius circle with a thin white outer ring +
// inner crosshair. Anchored at the click point, image-relative.
//
// Failure is non-fatal — if sharp isn't installed or the image can't be
// composited (e.g. SVG fallback parent), the call returns null and the
// caller proceeds with text-only inference.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
    log.warn(`sharp not available — click markers disabled: ${e?.message}`);
    sharpModule = null;
  }
  return sharpModule;
}

function buildMarkerSvg(imageW, imageH, [cx, cy]) {
  const px = Math.round(cx * imageW);
  const py = Math.round(cy * imageH);
  // Radius scales with image size so the marker stays visible across
  // 1920×1080 and 2752×1536. Roughly 2% of the longer edge.
  const r = Math.max(20, Math.round(Math.max(imageW, imageH) * 0.02));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${imageW}" height="${imageH}" viewBox="0 0 ${imageW} ${imageH}">
    <defs>
      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.4"/>
      </filter>
    </defs>
    <!-- White outer ring for contrast on dark backgrounds -->
    <circle cx="${px}" cy="${py}" r="${r + 4}" fill="none" stroke="#FFFFFF" stroke-width="3" filter="url(#shadow)"/>
    <!-- Red main circle -->
    <circle cx="${px}" cy="${py}" r="${r}" fill="none" stroke="#E03434" stroke-width="4"/>
    <!-- Crosshair lines -->
    <line x1="${px - r}" y1="${py}" x2="${px - r * 0.4}" y2="${py}" stroke="#E03434" stroke-width="3"/>
    <line x1="${px + r * 0.4}" y1="${py}" x2="${px + r}" y2="${py}" stroke="#E03434" stroke-width="3"/>
    <line x1="${px}" y1="${py - r}" x2="${px}" y2="${py - r * 0.4}" stroke="#E03434" stroke-width="3"/>
    <line x1="${px}" y1="${py + r * 0.4}" x2="${px}" y2="${py + r}" stroke="#E03434" stroke-width="3"/>
    <!-- Centre dot -->
    <circle cx="${px}" cy="${py}" r="4" fill="#E03434"/>
  </svg>`);
}

/**
 * Render a click marker on a copy of the parent's PNG and write it to /tmp.
 *
 * @param {object} args
 * @param {string} args.canvasId
 * @param {string} args.parentHash
 * @param {[number, number]} args.clickXY  image-relative 0..1
 * @param {string} args.jobId
 * @returns {Promise<string|null>} absolute path to the marked PNG, or null on failure
 */
export async function renderClickMarker({ canvasId, parentHash, clickXY, jobId }) {
  const sharp = await getSharp();
  if (!sharp) return null;

  // Only PNGs are markable (SVG fallback parents are skipped).
  const parentPng = paths.imagePath(canvasId, parentHash, 'png');
  try { await fs.stat(parentPng); } catch { return null; }

  const outDir = path.join(os.tmpdir());
  const outPath = path.join(outDir, `flipbook-click-${jobId}.png`);

  try {
    const meta = await sharp(parentPng).metadata();
    if (!meta.width || !meta.height) return null;
    // Downscale so the marker image stays small when fed to the
    // vision model. Generated parents are 1920×1080 or 2752×1536 PNGs
    // (multi-MB); when codebuddy base64-encodes such an image into the
    // session and then ECHOES it back in --output-format json stdout,
    // the stdout balloons to MBs of base64. diagnoseStdout then flags
    // that as `gibberish=true`/`truncated=true` and JSON parsing fails
    // on every retry. Capping the longest edge at 1024px and emitting a
    // compressed PNG keeps the file at tens of KB — the red marker is
    // still clearly visible to the model, and the echo is harmless.
    const MAX_EDGE = 1024;
    const scale = Math.min(1, MAX_EDGE / Math.max(meta.width, meta.height));
    const outW = Math.max(1, Math.round(meta.width * scale));
    const outH = Math.max(1, Math.round(meta.height * scale));
    // Build the marker SVG at the OUTPUT resolution so the overlay
    // composites pixel-for-pixel onto the resized base.
    const overlay = buildMarkerSvg(outW, outH, [
      Math.max(0, Math.min(1, clickXY[0])),
      Math.max(0, Math.min(1, clickXY[1])),
    ]);
    await sharp(parentPng)
      .resize(outW, outH, { fit: 'fill' })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png({ compressionLevel: 9, palette: true })
      .toFile(outPath);
    log.info(`[click-marker] ${jobId} → ${outPath} (${outW}×${outH})`);
    return outPath;
  } catch (e) {
    log.warn(`renderClickMarker failed: ${e?.message}`);
    return null;
  }
}
