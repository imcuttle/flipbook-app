/**
 * Image generation provider contract.
 *
 * Each provider exports a default object:
 *   {
 *     name: string,                  // 'codebuddy' | 'openai' | 'nanobanana' | 'seeddance' | 'svg' ...
 *     enabled(config): boolean,      // can this provider run with current env/config?
 *     async generate({
 *       imagePrompt,    // string — final prompt with style suffix already appended
 *       outputDir,      // absolute dir; provider writes <something>.png inside
 *       size,           // e.g. '1920x1080' (suggested; provider may pick its own)
 *       title,          // for fallback / logging
 *       hash,           // node hash; provider does NOT have to use this for the filename
 *       onEvent,        // optional (evt) => void to forward streaming progress upstream
 *     }) => Promise<{ ok: true, path: string } | { ok: false, reason: string }>
 *   }
 *
 * The generic `generateImage()` orchestrator (image.js) handles:
 *   - choosing the active provider via config.imageProvider with fallback list
 *   - renaming whatever path the provider returned to `<hash>.png`
 *   - SVG fallback if the chosen provider fails
 * Providers must NOT depend on the canvas hash for their filename — they pick
 * any name they like inside outputDir, and the orchestrator renames after.
 */

import codebuddy from './codebuddy.js';
import svg from './svg.js';
import openai from './openai.js';
import nanobanana from './nanobanana.js';
import seeddance from './seeddance.js';

const REGISTRY = new Map([
  ['codebuddy', codebuddy],
  ['openai', openai],
  ['nanobanana', nanobanana],
  ['seeddance', seeddance],
  ['svg', svg],
]);

export function listProviders() {
  return [...REGISTRY.keys()];
}

export function getProvider(name) {
  return REGISTRY.get(name) ?? null;
}

/**
 * Resolve a provider chain from `config.imageProvider`.
 * Accepts either a single name ("codebuddy") or a comma list ("openai,codebuddy,svg").
 * Returns the array of providers in order; unknown names are filtered out (logged once).
 * The 'svg' provider is always appended as the final fallback.
 */
export function resolveProviderChain(spec, log) {
  const want = String(spec || 'codebuddy')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const chain = [];
  for (const name of want) {
    const p = REGISTRY.get(name);
    if (!p) {
      log?.warn?.(`[image] unknown provider "${name}" — skipping`);
      continue;
    }
    if (!chain.includes(p)) chain.push(p);
  }
  // Always end with svg fallback
  if (!chain.includes(svg)) chain.push(svg);
  return chain;
}
