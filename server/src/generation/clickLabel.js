// Click-to-label inference: given parent node + click xy + existing labels,
// ask the LLM to produce { label, anchor_xy, leader_xy, next_prompt }.
import { loadPrompt } from './prompts.js';
import { callOnce } from '../codebuddyClient.js';
import { PlannerError } from '../lib/errors.js';

function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

export function validateClickLabel(raw, { click_xy }) {
  if (!raw || typeof raw !== 'object') throw new PlannerError('label output not an object');
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

export async function callClickLabel({ parentNode, clickXY, existingLabels }) {
  const promptText = await loadPrompt('click-label.md');
  const inputs = {
    parent_image_prompt: parentNode.image_prompt,
    parent_title: parentNode.title,
    parent_caption: parentNode.caption,
    click_xy: [clamp01(clickXY[0]), clamp01(clickXY[1])],
    existing_labels: (existingLabels || []).map((h) => ({
      label: h.label,
      anchor_xy: h.anchor_xy,
      leader_xy: h.leader_xy,
    })),
  };
  const prompt = [
    promptText,
    '',
    '## Inputs (JSON)',
    JSON.stringify(inputs, null, 2),
    '',
    '## Output',
    'Return JSON ONLY matching the schema above. No prose. No backticks.',
  ].join('\n');
  const { parsed } = await callOnce({ prompt });
  return validateClickLabel(parsed, { click_xy: inputs.click_xy });
}
