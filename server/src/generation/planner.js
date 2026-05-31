// Planner: builds the prompt and calls codebuddyClient.callOnce, then validates.
import { loadPrompt, loadPrompts } from './prompts.js';
import { callOnce } from '../codebuddyClient.js';
import { PlannerError } from '../lib/errors.js';
import { languageInstruction, normalizeLang } from './language.js';

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

export async function callPlanner({ topic, path = [], currentLabel = '', depth = 0, maxDepth = 99, sources = [], seedImagePath = null, seedDescription = null, lang = 'zh' }) {
  const userLang = normalizeLang(lang);
  const { system, planner } = await loadPrompts();
  // When a seed image is attached, layer in the image-extend prompt
  // addendum which forces preservation of the user's content/composition.
  let plannerBody = planner;
  if (seedImagePath) {
    try {
      const seedAddendum = await loadPrompt('planner-with-seed.md');
      plannerBody = `${planner}\n\n${seedAddendum}`;
    } catch { /* addendum file optional */ }
  }
  const inputs = {
    topic,
    path: path.map((p) => ({ title: p.title })),
    current_label: currentLabel,
    depth,
    max_depth: maxDepth,
    sources: sources.slice(0, 12).map((s) => ({
      title: s.title, url: s.url, snippet: s.snippet, source: s.source,
    })),
    lang: userLang,
    language_instruction: languageInstruction(userLang),
    has_seed_image: !!seedImagePath,
    // The describe-first step's structured read of what's actually
    // pictured. The planner's caption/title MUST be about this subject,
    // never about "the seed image" as a meta-object. When absent (stub
    // mode or describe failed), the planner falls back to topic.
    seed_subject: seedDescription?.subject || null,
    seed_description: seedDescription?.description || null,
    seed_features: seedDescription?.key_features || null,
  };
  const parts = [
    system,
    '',
    '## User language requirement',
    languageInstruction(userLang),
    '',
    plannerBody,
    '',
  ];
  if (seedImagePath) {
    parts.push(
      '## Seed image',
      `@${seedImagePath}`,
      '',
    );
    if (seedDescription?.subject) {
      parts.push(
        `## What the image actually shows`,
        `Subject: ${seedDescription.subject}`,
        seedDescription.description ? `Description: ${seedDescription.description}` : '',
        seedDescription.key_features?.length
          ? `Key features: ${seedDescription.key_features.join('; ')}`
          : '',
        '',
        'Your title, caption, and image_prompt must describe THIS SUBJECT — the actual thing pictured. NEVER write meta-references like "the seed image", "the source image", "the picture shows", "this image depicts". The reader must not be aware an upload exists; they should just see an annotated encyclopedia page about the subject.',
        '',
      );
    } else {
      parts.push(
        'A user-supplied source image is attached above. Treat it as the canonical visual content. Your job is to PRESERVE its subject, composition, and zone layout, only restyling to the encyclopedia look and adding 20–40 short text annotations OVER the existing scene. Title and caption must describe the SUBJECT pictured (not the image-as-an-object).',
        '',
      );
    }
  }
  parts.push(
    '## Inputs (JSON)',
    JSON.stringify(inputs, null, 2),
    '',
    '## Output',
    'Return JSON ONLY matching the schema above. No prose. No backticks.',
  );
  const prompt = parts.join('\n');
  const { parsed } = await callOnce({ prompt, tag: 'planner' });
  return validatePlannerOutput(parsed);
}
