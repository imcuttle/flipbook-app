// LLM-driven image-prompt repair.
//
// When ImageGen / ImageEdit refuses to invoke the tool and instead returns
// prose explaining WHY (e.g. "I can't process this prompt because it
// references a politically sensitive landmark with annotations about
// political history"), we don't try to outsmart the safety filter with
// regex substitutions — that approach risks butchering otherwise-fine
// prompts on unrelated topics.
//
// Instead, we run a fresh, small LLM call that receives:
//   * the original image prompt,
//   * the refusal prose verbatim,
//   * the optional seed-image description (from describeSeedImage),
// and asks it to REWRITE the prompt so it addresses the cited concern
// while preserving the structural intent (encyclopedia register, 5+
// zones, 20-40 annotations, the visual subject). The rewriter is told
// explicitly: don't drop the subject, don't drop annotations, just
// reframe the parts the previous attempt was refused for.
//
// Returns the rewritten prompt string, or null on failure. Caller treats
// null as "no repair available — fall through to whatever default
// behaviour you had before".
import { callOnce } from '../codebuddyClient.js';
import { log } from '../lib/log.js';
import { languageInstruction, normalizeLang } from './language.js';

function safeStr(v, max = 4000) {
  return String(v ?? '').slice(0, max);
}

export async function repairImagePrompt({ originalPrompt, refusalProse, seedDescription, jobId, lang = 'zh' }) {
  if (!originalPrompt || !refusalProse) return null;
  const userLang = normalizeLang(lang);
  const prompt = [
    'You are repairing an image-generation prompt that the image model refused to render. Your job is to produce a rewritten prompt that addresses the model\'s stated reason for refusal while preserving the encyclopedia-style intent (5+ visual zones with rich annotations, isometric cutaway register, factual museum-placard tone).',
    '',
    '## User language requirement',
    languageInstruction(userLang),
    '',
    '## Original prompt',
    safeStr(originalPrompt, 6000),
    '',
    '## Why the model refused (verbatim)',
    safeStr(refusalProse, 1500),
    '',
    seedDescription?.subject
      ? `## What the source image actually shows\nSubject: ${seedDescription.subject}\n${seedDescription.description ? 'Description: ' + seedDescription.description : ''}`
      : '',
    '',
    '## Rewrite rules',
    '- Identify, from the refusal prose, what specifically the model objected to (a name, a sensitive framing, an explicit theme, etc.).',
    '- Reframe THOSE parts in a way the model would accept: typically by recasting from a cultural/architectural/educational angle. If the refusal cites a specific named landmark, swap the proper noun for a descriptive paraphrase that conveys the same visual without naming it.',
    '- DO NOT delete the structural requirements (5+ zones, dense annotations, encyclopedia caption, isometric register, soft beige background, fine line work, 20–40 short text fragments).',
    '- DO NOT replace the SUBJECT with something unrelated. The new prompt should describe the same scene at the same level of visual fidelity, only with the offending framing softened.',
    '- The output is consumed by an image generator; keep it descriptive and concrete, not meta. Do NOT mention "the previous prompt" or "the refusal".',
    '',
    '## Output: STRICT JSON',
    '```json',
    '{',
    '  "rewritten_prompt": "the full repaired image prompt, ready to be passed to ImageGen as-is",',
    '  "rationale": "one short sentence explaining what you changed and why"',
    '}',
    '```',
    '',
    'Output JSON only. No backticks. No commentary.',
  ].filter(Boolean).join('\n');

  try {
    const { parsed } = await callOnce({ prompt });
    if (!parsed || typeof parsed !== 'object') return null;
    const out = String(parsed.rewritten_prompt ?? '').trim();
    if (!out) return null;
    if (jobId) {
      const rationale = String(parsed.rationale ?? '').slice(0, 240);
      log.info(`[gen ${jobId}] image.repair → "${rationale}" (${out.length}c)`);
    }
    return out;
  } catch (e) {
    log.warn(`[gen ${jobId ?? '?'}] image.repair failed: ${e?.message}`);
    return null;
  }
}
