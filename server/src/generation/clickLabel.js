// Click-to-label inference: given parent node + click xy + existing labels,
// ask the LLM to produce { label, anchor_xy, leader_xy, next_prompt }.
import { loadPrompt } from './prompts.js';
import { callOnce } from '../codebuddyClient.js';
import { renderClickMarker } from './clickMarker.js';
import { PlannerError } from '../lib/errors.js';
import { languageInstruction, normalizeLang } from './language.js';

function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

export function validateClickLabel(raw, { click_xy }) {
  if (!raw || typeof raw !== 'object') throw new PlannerError('label output not an object');
  // Rejection branch: the LLM didn't see anything drillable under the click.
  // Only treat as rejected if the model explicitly says so. A missing
  // `confident` field defaults to confident (so unmodified shape-A outputs
  // still work).
  if (raw.confident === false) {
    return {
      rejected: true,
      reason: String(raw.reason ?? '').slice(0, 240) || 'no drillable subject under click',
    };
  }
  const { label, anchor_xy, leader_xy, next_prompt } = raw;
  if (typeof label !== 'string' || !label.trim()) throw new PlannerError('label missing');
  const ax = Array.isArray(anchor_xy) ? [clamp01(anchor_xy[0]), clamp01(anchor_xy[1])] : [clamp01(click_xy[0] + 0.1), clamp01(click_xy[1] + 0.05)];
  const lx = Array.isArray(leader_xy) ? [clamp01(leader_xy[0]), clamp01(leader_xy[1])] : [clamp01(click_xy[0]), clamp01(click_xy[1])];
  return {
    label: String(label).slice(0, 80),
    anchor_xy: ax,
    leader_xy: lx,
    next_prompt: String(next_prompt ?? '').slice(0, 400),
  };
}

// Pull the OCR'd text fragments closest to the click. Each span has an
// image-relative bbox = [x, y, w, h]; we compare against the centre of
// the bbox. Returns up to `limit` spans sorted by ascending distance,
// with their distance attached so the LLM can weight by proximity.
function nearbyOcrSpans(textLayer, [cx, cy], { radius = 0.18, limit = 12 } = {}) {
  if (!Array.isArray(textLayer) || textLayer.length === 0) return [];
  const out = [];
  for (const s of textLayer) {
    const bbox = Array.isArray(s?.bbox) ? s.bbox : null;
    if (!bbox || bbox.length < 4) continue;
    const sx = bbox[0] + bbox[2] / 2;
    const sy = bbox[1] + bbox[3] / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) continue;
    out.push({
      text: String(s.text ?? '').slice(0, 60),
      xy: [Number(sx.toFixed(3)), Number(sy.toFixed(3))],
      dist: Number(dist.toFixed(3)),
    });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, limit);
}

export async function callClickLabel({ parentNode, clickXY, existingLabels, canvasId, jobId, lang = 'zh' }) {
  const userLang = normalizeLang(lang);
  const promptText = await loadPrompt('click-label.md');
  const cx = clamp01(clickXY[0]);
  const cy = clamp01(clickXY[1]);

  // Render a click marker on a copy of the parent image. The marked PNG
  // is written to /tmp and referenced in the prompt with codebuddy's
  // `@<path>` syntax — when the underlying model is multimodal, this is
  // picked up as an attached image and the LLM can literally see what's
  // under the red circle. Even when not, the file remains a valuable
  // post-mortem artifact (open it to see what the user actually clicked).
  let markerPath = null;
  if (canvasId && parentNode?.hash && jobId) {
    markerPath = await renderClickMarker({
      canvasId,
      parentHash: parentNode.hash,
      clickXY: [cx, cy],
      jobId,
    });
  }

  const inputs = {
    lang: userLang,
    language_instruction: languageInstruction(userLang),
    parent_image_prompt: parentNode.image_prompt,
    parent_title: parentNode.title,
    parent_caption: parentNode.caption,
    click_xy: [cx, cy],
    // Nearby OCR'd in-image text — strongest spatial signal we have. The
    // model otherwise has to back-infer "what's at xy" from the prose
    // image_prompt, which is unreliable. Spans within 0.18 units of the
    // click, sorted by distance.
    nearby_text: nearbyOcrSpans(parentNode.text_layer, [cx, cy]),
    existing_labels: (existingLabels || []).map((h) => ({
      label: h.label,
      anchor_xy: h.anchor_xy,
      leader_xy: h.leader_xy,
    })),
  };
  const promptParts = [
    '## User language requirement',
    languageInstruction(userLang),
    '',
    promptText,
  ];
  if (markerPath) {
    // Include the @-reference up front so any vision-capable model loads
    // it alongside the prompt. Plain-text models simply see a path string
    // and ignore it — no harm done.
    promptParts.push('', `## Click marker image`, `@${markerPath}`, '',
      'A red circled crosshair has been drawn on the parent image at the user\'s click point. Treat this as the strongest possible spatial signal: the subject is whatever is INSIDE or directly UNDER the red circle.');
  }
  promptParts.push(
    '',
    '## Inputs (JSON)',
    JSON.stringify(inputs, null, 2),
    '',
    '## Output',
    'Return JSON ONLY matching the schema above. No prose. No backticks.',
  );
  const prompt = promptParts.join('\n');
  const { parsed } = await callOnce({ prompt });
  return validateClickLabel(parsed, { click_xy: inputs.click_xy });
}
