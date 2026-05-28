import path from 'node:path';
import fs from 'node:fs/promises';
import { extractStyleSuffix, loadPrompts } from './prompts.js';
import { writeFallbackSvg } from '../lib/svgFallback.js';
import { paths } from '../store/paths.js';
import { config } from '../config.js';
import { log } from '../lib/log.js';
import { resolveProviderChain } from './providers/index.js';

let cachedSuffix = null;
async function getStyleSuffix() {
  if (cachedSuffix) return cachedSuffix;
  const { imagePrompt } = await loadPrompts();
  cachedSuffix = extractStyleSuffix(imagePrompt);
  return cachedSuffix;
}

let cachedChain = null;
function chain() {
  if (cachedChain) return cachedChain;
  cachedChain = resolveProviderChain(config.imageProvider, log);
  log.info(`[image] provider chain: ${cachedChain.map((p) => p.name).join(' → ')}`);
  return cachedChain;
}

async function statBigEnough(p, minBytes = 512) {
  try { return (await fs.stat(p)).size >= minBytes; } catch { return false; }
}

/**
 * Generate an image for a node. Returns { ext: 'png'|'svg', fallback: bool, providerName }.
 * Always produces a file at paths.imagePath(canvasId, hash, <ext>).
 *
 * Behaviour:
 *   1. Walk the configured provider chain in order.
 *   2. For each provider where `enabled(config)` is true, call `generate()`.
 *   3. The first one that returns ok and writes a non-trivial file wins.
 *   4. The orchestrator renames the provider's output to `<hash>.png` (or `.svg`
 *      for the svg fallback).
 *   5. If every real provider fails, the always-on `svg` provider produces a
 *      placeholder. The pipeline never returns without a file.
 */
export async function generateImage({ canvasId, hash, title, imagePrompt, onEvent }) {
  const targetPng = paths.imagePath(canvasId, hash, 'png');
  const dir = path.dirname(targetPng);
  await fs.mkdir(dir, { recursive: true });

  const suffix = await getStyleSuffix();
  const finalPrompt = imagePrompt + suffix;

  const reasons = [];
  for (const provider of chain()) {
    if (!provider.enabled(config)) {
      reasons.push(`${provider.name}: disabled (no env/config)`);
      continue;
    }
    let result;
    try {
      result = await provider.generate({
        imagePrompt: finalPrompt,
        outputDir: dir,
        size: config.imageSize,
        title,
        hash,
        onEvent,
      });
    } catch (e) {
      result = { ok: false, reason: e?.message ?? String(e) };
    }

    if (!result?.ok || !result.path) {
      reasons.push(`${provider.name}: ${result?.reason ?? 'no path'}`);
      log.warn(`[image] ${provider.name} failed: ${result?.reason}`);
      continue;
    }

    // Rename the produced file to the canonical <hash>.<ext>.
    const ext = result.path.toLowerCase().endsWith('.svg') ? 'svg' : 'png';
    const target = paths.imagePath(canvasId, hash, ext);
    try {
      if (path.resolve(result.path) !== path.resolve(target)) {
        await fs.rename(result.path, target);
      }
      if (await statBigEnough(target)) {
        return {
          ext,
          fallback: provider.name === 'svg',
          providerName: provider.name,
        };
      }
      reasons.push(`${provider.name}: written file too small`);
    } catch (e) {
      reasons.push(`${provider.name}: rename failed: ${e?.message}`);
    }
  }

  // Belt-and-suspenders: if even the svg fallback couldn't write, synthesise one inline.
  const svgPath = paths.imagePath(canvasId, hash, 'svg');
  await writeFallbackSvg(svgPath, { title, hash });
  return {
    ext: 'svg',
    fallback: true,
    providerName: 'svg-inline',
    reason: reasons.join('; '),
  };
}
