import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const cache = new Map();

export async function loadPrompt(name) {
  if (cache.has(name)) return cache.get(name);
  const p = path.join(config.promptsDir, name);
  const text = await fs.readFile(p, 'utf8');
  cache.set(name, text);
  return text;
}

export async function loadPrompts() {
  const [system, planner, imagePrompt] = await Promise.all([
    loadPrompt('system.md'),
    loadPrompt('planner.md'),
    loadPrompt('image-prompt.md'),
  ]);
  return { system, planner, imagePrompt };
}

// Extract the style suffix line from image-prompt.md (the line beginning with ", isometric ...").
export function extractStyleSuffix(imagePromptMd) {
  const m = imagePromptMd.match(/^>\s*`(,[^`]+)`/m);
  if (m) return m[1];
  // Fallback: hardcoded suffix
  return ', isometric cutaway illustration, soft beige background (#F5EFE6), fine line work, muted natural colors, dense diagram-style text annotations: each zone has a 2-6 word heading plus 2-4 small callout labels (1-5 words each, sans-serif, dark grey, small relative to the scene), aim for 20-40 short text fragments total, viewed from a slight elevated angle, 16:9 composition';
}
