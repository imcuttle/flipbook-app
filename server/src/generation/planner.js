// Planner: builds the prompt and calls codebuddyClient.callOnce, then validates.
import { loadPrompts } from './prompts.js';
import { callOnce } from '../codebuddyClient.js';
import { PlannerError } from '../lib/errors.js';

export function validatePlannerOutput(raw) {
  if (!raw || typeof raw !== 'object') throw new PlannerError('planner output not an object');
  const { title, caption, image_prompt } = raw;
  if (typeof title !== 'string' || !title.trim()) throw new PlannerError('title missing');
  if (typeof caption !== 'string') throw new PlannerError('caption missing');
  if (typeof image_prompt !== 'string' || !image_prompt.trim()) throw new PlannerError('image_prompt missing');
  return {
    title: String(title).slice(0, 80),
    caption: String(caption).slice(0, 220),
    image_prompt: String(image_prompt),
  };
}

export async function callPlanner({ topic, path = [], currentLabel = '', depth = 0, maxDepth = 99, sources = [] }) {
  const { system, planner } = await loadPrompts();
  const inputs = {
    topic,
    path: path.map((p) => ({ title: p.title })),
    current_label: currentLabel,
    depth,
    max_depth: maxDepth,
    sources: sources.slice(0, 12).map((s) => ({
      title: s.title, url: s.url, snippet: s.snippet, source: s.source,
    })),
  };
  const prompt = [
    system,
    '',
    planner,
    '',
    '## Inputs (JSON)',
    JSON.stringify(inputs, null, 2),
    '',
    '## Output',
    'Return JSON ONLY matching the schema above. No prose. No backticks.',
  ].join('\n');
  const { parsed } = await callOnce({ prompt });
  return validatePlannerOutput(parsed);
}
