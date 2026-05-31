// LLM-driven TOPIC repair.
//
// When the planner refuses a topic on content-policy grounds (a sensitive
// term, a politically fraught framing, etc.), we don't try to outsmart the
// safety filter with regex substitutions. Instead we run a small LLM call
// that receives the refused topic + the refusal prose and asks it to rewrite
// the topic into a NON-SENSITIVE, encyclopedia-appropriate paraphrase that
// preserves the user's underlying informational intent where possible.
//
// Returns the rewritten topic string (≤ 60 chars), or null on failure /
// when the request is fundamentally not salvageable (the rewriter is told to
// return an empty string in that case, e.g. for genuinely disallowed
// content, so we don't loop forever or produce something inappropriate).
import { callOnce } from '../codebuddyClient.js';
import { log } from '../lib/log.js';
import { languageInstruction, normalizeLang } from './language.js';

function safeStr(v, max = 2000) {
  return String(v ?? '').slice(0, max);
}

export async function repairTopic({ originalTopic, refusalProse, jobId, lang = 'zh' }) {
  if (!originalTopic) return null;
  const userLang = normalizeLang(lang);
  const prompt = [
    'You rewrite a knowledge-page TOPIC that an upstream model declined to process on content-policy grounds. Produce a safe, neutral, encyclopedia-appropriate rephrasing that keeps the user\'s underlying informational intent wherever it is legitimately answerable.',
    '',
    '## User language requirement',
    languageInstruction(userLang),
    '',
    '## Original topic (refused)',
    safeStr(originalTopic, 300),
    '',
    '## Why it was refused (verbatim, may be in another language)',
    safeStr(refusalProse, 1200),
    '',
    '## Rewrite rules',
    '- Identify what specifically was objectionable (a sensitive proper noun, a political / violent / adult framing, etc.).',
    '- Recast it from a neutral cultural / historical / scientific / architectural / educational angle that a general encyclopedia would cover. Replace a sensitive named entity with a descriptive, non-identifying paraphrase of the same general subject when reasonable.',
    '- Keep it SHORT — a topic title, not a sentence (≤ 60 characters / 字).',
    '- Preserve the core subject where it is legitimately answerable; only soften the offending framing.',
    '- If the request is fundamentally disallowed (genuinely unsafe / sexual / hateful / targeted at a real private individual) and cannot be made into a benign encyclopedia topic, return an EMPTY string for `topic`. Do NOT force an unrelated topic.',
    '',
    '## Output: STRICT JSON',
    '```json',
    '{',
    '  "topic": "the rewritten safe topic, or empty string if not salvageable",',
    '  "rationale": "one short sentence on what you changed (or why it is not salvageable)"',
    '}',
    '```',
    '',
    'Output JSON only. No backticks. No commentary.',
  ].join('\n');

  try {
    const { parsed } = await callOnce({ prompt, tag: 'repair-topic' });
    if (!parsed || typeof parsed !== 'object') return null;
    const out = String(parsed.topic ?? '').trim().slice(0, 60);
    const rationale = String(parsed.rationale ?? '').slice(0, 240);
    if (jobId) log.info(`[gen ${jobId}] topic.repair → "${out}" (${rationale})`);
    // Empty / unchanged → not salvageable. Returning null tells the caller
    // to give up and surface the refusal as before.
    if (!out || out === String(originalTopic).trim()) return null;
    return out;
  } catch (e) {
    log.warn(`[gen ${jobId ?? '?'}] topic.repair failed: ${e?.message}`);
    return null;
  }
}
