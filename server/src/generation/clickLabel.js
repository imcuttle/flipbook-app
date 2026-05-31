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
  // The label is occasionally returned under an alternate key (the model
  // drifts between `label` / `title` / `name` / `subject`). Accept any of
  // them before giving up.
  const { anchor_xy, leader_xy, next_prompt } = raw;
  const labelRaw = [raw.label, raw.title, raw.name, raw.subject]
    .find((v) => typeof v === 'string' && v.trim());
  // If there's genuinely no usable label, DON'T crash the whole job —
  // treat it as a soft rejection so the pipeline clears the pending
  // bubble and toasts the user instead of throwing an unhandled error.
  if (!labelRaw) {
    return {
      rejected: true,
      reason: String(raw.reason ?? '').slice(0, 240) || 'could not infer a label for this spot',
    };
  }
  // Sanity-check the label is a short PLAIN-TEXT phrase, not markup. The
  // model occasionally echoes HTML/CSS (e.g. the rendered card's own
  // `<div style="width:240px;font-family:...">`) or other junk back as the
  // "label"; rendering that verbatim in a hotspot card is the bug we're
  // guarding against. Reject anything containing tag/markup characters,
  // CSS-ish tokens, or that's implausibly long for a 1–6 word label.
  const labelStr = String(labelRaw).trim();
  const looksLikeMarkup = /[<>{}]|style\s*=|font-family|<\/?\w+|&[a-z]+;|;\s*[a-z-]+\s*:/i.test(labelStr);
  if (looksLikeMarkup || labelStr.length > 60) {
    return {
      rejected: true,
      reason: 'could not infer a clean label for this spot',
    };
  }
  // Defensive guard: the red crosshair/circle is a synthetic overlay the
  // software draws to point at the click — it is NOT part of the scene. If
  // the model named the marker itself (instead of the underlying subject),
  // reject so we never surface "红色准星 / red crosshair" as a hotspot label
  // or seed the child prompt with it.
  const namesMarker = /红色?(准星|准心|圆圈|圈|标记|十字|准星标记)|准星|crosshair|red\s+(circle|ring|dot|marker|crosshair|target)|\bmarker\b|reticle/i;
  if (namesMarker.test(labelStr) || namesMarker.test(String(next_prompt ?? ''))) {
    return {
      rejected: true,
      reason: 'could not infer a clean label for this spot',
    };
  }
  const ax = Array.isArray(anchor_xy) ? [clamp01(anchor_xy[0]), clamp01(anchor_xy[1])] : [clamp01(click_xy[0] + 0.1), clamp01(click_xy[1] + 0.05)];
  const lx = Array.isArray(leader_xy) ? [clamp01(leader_xy[0]), clamp01(leader_xy[1])] : [clamp01(click_xy[0]), clamp01(click_xy[1])];
  return {
    label: labelStr.slice(0, 80),
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

  const nearby = nearbyOcrSpans(parentNode.text_layer, [cx, cy]);
  // The full parent_image_prompt enumerates every zone heading + callout
  // label the planner wrote. Feeding it to the click-label model invites
  // a failure mode where the model — especially if it doesn't actually
  // read the marker image — just grabs SOME plausible label from that
  // prose that loosely matches the click region (e.g. returning a label
  // listed elsewhere in the scene for a click on an unrelated spot).
  // So we OMIT image_prompt whenever we have a stronger spatial signal
  // (the marker image and/or nearby OCR). We keep only title + caption
  // as light scene context. When neither stronger signal exists, we fall
  // back to including image_prompt so the model has something to go on.
  const haveStrongSpatialSignal = !!markerPath || nearby.length > 0;
  const inputs = {
    lang: userLang,
    language_instruction: languageInstruction(userLang),
    parent_title: parentNode.title,
    parent_caption: parentNode.caption,
    ...(haveStrongSpatialSignal ? {} : { parent_image_prompt: parentNode.image_prompt }),
    click_xy: [cx, cy],
    // Nearby OCR'd in-image text — strongest spatial signal we have. The
    // model otherwise has to back-infer "what's at xy" from the prose
    // image_prompt, which is unreliable. Spans within 0.18 units of the
    // click, sorted by distance.
    nearby_text: nearby,
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
      'A red circled crosshair has been drawn on the parent image at the user\'s EXACT click pixel. This is the SINGLE STRONGEST signal. Identify only what is physically INSIDE or directly UNDER the red circle. Do NOT pick a label from elsewhere in the scene just because it appears in the text inputs — name the specific object at that pixel. If the circled area is empty / background with no drillable object, return the rejection shape (confident:false).'
      + ' CRITICAL: the red circle / crosshair / marker is a SYNTHETIC overlay added by the software purely to point at the click — it is NOT part of the picture. NEVER name, mention, or describe the red marker (no "红色准星", "red crosshair", "red circle", "marker", "标记", etc.) in `label` or `next_prompt`. Describe ONLY the real underlying subject it sits on. If the marker covers nothing but background, reject with confident:false.');
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
  const { parsed } = await callOnce({ prompt, tag: 'click-label' });
  return validateClickLabel(parsed, { click_xy: inputs.click_xy });
}
