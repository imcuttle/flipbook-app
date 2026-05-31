// Decide whether to consult the web before planning a node.
// Returns {should_search, queries}.
import { loadPrompt } from './prompts.js';
import { callOnce } from '../codebuddyClient.js';

function isCJK(s) { return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s || ''); }

export function stubDecideSearch({ topic, currentLabel, depth }) {
  const subject = (currentLabel || topic || '').toString().trim();
  if (!subject || depth >= 5) return { should_search: false, queries: [] };
  // Default: search for any non-empty subject. The real LLM does the nuanced
  // abstract/fictional skip; this stub just exercises the pipeline path.
  const cn = isCJK(subject);
  return {
    should_search: true,
    queries: cn
      ? [`${subject} 概况`, `${subject} 历史`]
      : [`${subject} overview`, `${subject} history`],
  };
}

export function validateDecideOutput(raw) {
  if (!raw || typeof raw !== 'object') return { should_search: false, queries: [] };
  const should = !!raw.should_search;
  const queries = Array.isArray(raw.queries)
    ? raw.queries.map((q) => String(q).slice(0, 120)).filter(Boolean).slice(0, 3)
    : [];
  return { should_search: should && queries.length > 0, queries };
}

export async function callDecideSearch({ topic, path = [], currentLabel = '', intent = 'root' }) {
  const promptText = await loadPrompt('decide-search.md');
  const inputs = {
    topic,
    path: path.map((p) => ({ title: p.title })),
    current_label: currentLabel,
    intent,
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
  try {
    const { parsed } = await callOnce({ prompt, tag: 'decide-search' });
    return validateDecideOutput(parsed);
  } catch {
    return { should_search: false, queries: [] };
  }
}
