#!/usr/bin/env node
// Manually re-sync skill/prompts/*.md → app/prompts/*.md
// system.md and image-prompt.md are byte-copies.
// planner.md is NOT auto-overwritten because the CS app appends "Language
// passthrough" + "Information density" sections; the script only diffs and warns.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, '..', '..', 'skill', 'prompts');
const appDir = path.resolve(__dirname, '..', 'prompts');

function copyIfChanged(name) {
  const src = path.join(skillDir, name);
  const dst = path.join(appDir, name);
  const srcBuf = fs.readFileSync(src);
  let dstBuf = null;
  try { dstBuf = fs.readFileSync(dst); } catch {}
  if (dstBuf && Buffer.compare(srcBuf, dstBuf) === 0) {
    console.log(`[ok]   ${name} unchanged`);
    return;
  }
  fs.writeFileSync(dst, srcBuf);
  console.log(`[copy] ${name}`);
}

function warnIfPlannerDrifted() {
  const src = fs.readFileSync(path.join(skillDir, 'planner.md'), 'utf8');
  const dst = fs.readFileSync(path.join(appDir, 'planner.md'), 'utf8');
  // Naive prefix check: app planner must start with the same content as skill planner.
  if (!dst.startsWith(src.trimEnd().split('## Output JSON only')[0])) {
    console.warn('[warn] app/prompts/planner.md prefix has diverged from skill/prompts/planner.md — review manually.');
  } else {
    console.log('[ok]   planner.md prefix matches skill (CS additions preserved)');
  }
}

copyIfChanged('system.md');
copyIfChanged('image-prompt.md');
warnIfPlannerDrifted();
