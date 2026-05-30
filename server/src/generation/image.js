import path from 'node:path';
import fs from 'node:fs/promises';
import { extractStyleSuffix, loadPrompts } from './prompts.js';
import { writeFallbackSvg } from '../lib/svgFallback.js';
import { paths } from '../store/paths.js';
import { config } from '../config.js';
import { log } from '../lib/log.js';
import { resolveProviderChain } from './providers/index.js';
import { repairImagePrompt } from './repairPrompt.js';
import { imageLanguageInstruction, normalizeLang } from './language.js';

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
 *   3. If a provider fails AND the failure carried prose (typical of a
 *      content-policy refusal), run an LLM-driven prompt repair against
 *      the prose and retry the SAME provider once with the repaired
 *      prompt. Only one repair attempt per provider — if that still
 *      fails we move on.
 *   4. The first provider that returns ok and writes a non-trivial file
 *      wins.
 *   5. The orchestrator renames the provider's output to `<hash>.png`
 *      (or `.svg` for the svg fallback).
 *   6. If every real provider fails, the always-on `svg` provider
 *      produces a placeholder. The pipeline never returns without a file.
 *
 * `onPhase` (optional) is called with `{phase, message}` at each user-
 * facing milestone so the SSE pipeline can stream a status line into the
 * pending click bubble. Phases: 'image.start', 'image.repair',
 * 'image.retry', 'image.done', 'image.fallback'.
 */
export async function generateImage({ canvasId, hash, title, imagePrompt, seedImagePath = null, seedDescription = null, lang = 'zh', onEvent, onPhase }) {
  const userLang = normalizeLang(lang);
  const targetPng = paths.imagePath(canvasId, hash, 'png');
  const dir = path.dirname(targetPng);
  await fs.mkdir(dir, { recursive: true });

  const suffix = await getStyleSuffix();
  // When a seed image is attached, prepend an explicit instruction to do
  // an image-to-image edit. Vision-capable providers invoke their
  // ImageEdit tool when they see the @-reference; text-to-image providers
  // ignore the path but get a vivid textual description of the subject
  // (lifted by describeSeedImage) so they can still reconstruct the
  // subject faithfully instead of re-imagining it from scratch.
  let prefix = '';
  if (seedImagePath) {
    prefix += `Image-to-image edit of @${seedImagePath} — preserve the source's subject, composition, and zone layout exactly; only restyle and add diagram annotations described below.\n\n`;
    if (seedDescription?.subject) {
      prefix += `Subject (from the source): ${seedDescription.subject}.\n`;
      if (seedDescription.description) prefix += `Source description: ${seedDescription.description}\n`;
      if (seedDescription.key_features?.length) {
        prefix += `Key features to preserve: ${seedDescription.key_features.join('; ')}.\n`;
      }
      prefix += '\n';
    }
  }
  const initialPrompt = [
    imageLanguageInstruction(userLang),
    '',
    prefix + imagePrompt + suffix,
  ].join('\n');

  function emitPhase(phase, message) {
    try { onPhase?.({ phase, message }); } catch { /* ignore */ }
  }

  emitPhase('image.start', 'Generating illustration…');

  const reasons = [];
  for (const provider of chain()) {
    if (!provider.enabled(config)) {
      reasons.push(`${provider.name}: disabled (no env/config)`);
      continue;
    }

    // Each provider gets up to two tries: the original prompt, and (if
    // the first failed with a content-policy-style prose refusal) a
    // freshly LLM-repaired prompt that addresses the cited reason.
    let promptForProvider = initialPrompt;
    let repaired = false;
    for (let providerAttempt = 1; providerAttempt <= 2; providerAttempt++) {
      let result;
      try {
        result = await provider.generate({
          imagePrompt: promptForProvider,
          outputDir: dir,
          size: config.imageSize,
          title,
          hash,
          seedImagePath: providerAttempt === 1 ? seedImagePath : null, // repair retry drops seed
          onEvent,
        });
      } catch (e) {
        result = { ok: false, reason: e?.message ?? String(e) };
      }

      if (result?.ok && result.path) {
        // Rename the produced file to the canonical <hash>.<ext>.
        const ext = result.path.toLowerCase().endsWith('.svg') ? 'svg' : 'png';
        const target = paths.imagePath(canvasId, hash, ext);
        try {
          if (path.resolve(result.path) !== path.resolve(target)) {
            await fs.rename(result.path, target);
          }
          if (await statBigEnough(target)) {
            emitPhase('image.done', repaired ? 'Generated (after refining prompt)' : 'Generated');
            return {
              ext,
              fallback: provider.name === 'svg',
              providerName: provider.name,
              repaired,
            };
          }
          reasons.push(`${provider.name}: written file too small`);
        } catch (e) {
          reasons.push(`${provider.name}: rename failed: ${e?.message}`);
        }
        // If we got here the rename failed or file was too small — break
        // and try the next provider instead of running the repair.
        break;
      }

      reasons.push(`${provider.name} (attempt ${providerAttempt}): ${result?.reason ?? 'no path'}`);
      log.warn(`[image] ${provider.name} attempt ${providerAttempt} failed: ${result?.reason}`);

      // Decide whether to spend an LLM call repairing the prompt and
      // retrying the same provider. Conditions:
      //   * we still have an attempt budget for this provider,
      //   * the failure carried prose (refusal explanation),
      //   * we haven't repaired already for this provider.
      if (providerAttempt < 2 && !repaired && result?.refusalProse) {
        // If we had a seed image and the model refused on the EDIT attempt,
        // the retry below drops the seed (text-to-image). Surface this as a
        // distinct compliance-risk signal so the pipeline can warn the user
        // that their uploaded image likely tripped a content policy and we
        // fell back to generating from the description instead.
        if (seedImagePath) {
          // Carry the model's own reason so the user understands WHY the
          // upload was declined (truncated to keep the toast readable).
          // Localised to the generation's language.
          const reason = String(result.refusalProse).replace(/\s+/g, ' ').trim().slice(0, 180);
          const msg = userLang === 'en'
            ? (reason
                ? `Your uploaded image was declined by the image model (possible content-policy issue): ${reason} — generating from its description instead.`
                : 'Your uploaded image was declined by the image model (possible content-policy issue) — generating from its description instead.')
            : (reason
                ? `上传图片被图像模型拒绝(可能涉及内容合规):${reason} — 已改用根据描述生成。`
                : '上传图片被图像模型拒绝(可能涉及内容合规) — 已改用根据描述生成。');
          emitPhase('image.seed_refused', msg);
        }
        emitPhase('image.repair',
          'Image model declined — rewriting the prompt to address its concerns…');
        const newPrompt = await repairImagePrompt({
          originalPrompt: promptForProvider,
          refusalProse: result.refusalProse,
          seedDescription,
          lang: userLang,
        });
        if (newPrompt) {
          promptForProvider = newPrompt;
          repaired = true;
          emitPhase('image.retry', 'Retrying with refined prompt…');
          continue; // try the same provider again
        }
        // No repair available — break out and try the next provider.
        break;
      }
      // Otherwise: no point retrying this provider, move on.
      break;
    }
  }

  // Belt-and-suspenders: if even the svg fallback couldn't write, synthesise one inline.
  emitPhase('image.fallback', 'All providers failed — using placeholder');
  const svgPath = paths.imagePath(canvasId, hash, 'svg');
  await writeFallbackSvg(svgPath, { title, hash });
  return {
    ext: 'svg',
    fallback: true,
    providerName: 'svg-inline',
    reason: reasons.join('; '),
  };
}
