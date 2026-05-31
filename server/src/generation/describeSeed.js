// Describe a user-supplied seed image so downstream steps (planner,
// decide-search, image generation) can work from a vivid textual subject
// instead of from filename / upload metadata.
//
// Output schema:
//   {
//     subject: "<concise noun phrase, user's language; the SUBJECT pictured>",
//     description: "<2-4 sentence vivid description of what's in the image>",
//     key_features: ["<short bullet>", ...],
//     suggested_topic: "<title-cased phrase, max 30 chars; what to label this canvas>",
//     search_queries: ["<query 1>", "<query 2>", "<query 3>"]
//   }
//
// All fields are model-best-effort. Falls back to safe defaults on parse failure.
import { callOnce } from '../codebuddyClient.js';
import { log } from '../lib/log.js';
import { normalizeLang } from './language.js';

function safeStr(v, max = 240) {
  return String(v ?? '').slice(0, max);
}

function safeStrArr(v, maxItems = 6, maxLen = 160) {
  if (!Array.isArray(v)) return [];
  return v.map((s) => safeStr(s, maxLen).trim()).filter(Boolean).slice(0, maxItems);
}

export async function describeSeedImage({ seedImagePath, userTopic, lang = 'zh' }) {
  if (!seedImagePath) return null;
  const userLang = normalizeLang(lang);
  const langDirective = userLang === 'en'
    ? 'All JSON string values must be in English, including subject, description, key_features, suggested_topic, and search_queries.'
    : '所有 JSON 字符串值都必须使用中文,包括 subject、description、key_features、suggested_topic 和 search_queries。';

  function buildPrompt({ sceneOnly }) {
    // sceneOnly mode is used as a fallback when the model refuses to
    // describe an image because it contains an identifiable person. We
    // tell it to anonymise ONLY the identifiable individual (replace with
    // a generic, non-identifying figure) while STILL faithfully capturing
    // every other key subject, object, composition and setting — so the
    // downstream text-to-image step can closely recreate the original
    // scene (subject + layout), just without reproducing the real person.
    const sceneRule = sceneOnly
      ? (userLang === 'en'
          ? 'IMPORTANT: The image may contain an identifiable real person. Do NOT identify, name, or reproduce that specific individual. BUT do NOT discard the rest of the picture — faithfully capture EVERY other key subject, the main focal object(s), their arrangement/composition, colours, materials, setting, architecture and any visible text. If a human is the focal point, describe them only generically (e.g. "a visitor", "a standing figure") and keep their pose/placement so the scene can be recreated closely. The goal is a faithful reconstruction of the scene minus the real person\'s identity.'
          : '重要:图中可能包含可识别的真人。不要识别、命名或复刻该具体个人。但不要因此丢弃画面其余内容——要忠实记录其他每一个关键主体、主要焦点物体、它们的布局/构图、颜色、材质、场景、建筑和任何可见文字。若人物是焦点,只用泛化方式描述(如"一位游客""一个站立的人影")并保留其姿态/位置,以便尽量贴近地复刻该场景。目标是在不暴露真人身份的前提下忠实重建画面。')
      : null;
    return [
      'You are inspecting a user-supplied source image and producing a STRUCTURED summary that downstream steps will use to build an annotated encyclopedia-style flipbook page.',
      '',
      `## Image to describe`,
      `@${seedImagePath}`,
      '',
      `## Output: STRICT JSON only`,
      '```json',
      '{',
      '  "subject": "concise noun phrase naming the SUBJECT pictured. Do NOT use meta-words like \\"a photo of\\" or \\"the seed image\\". Examples: \\"Pineapple bun\\", \\"赣菜全景图\\", \\"woodpecker tongue anatomy\\".",',
      '  "description": "2-4 sentences describing what is actually visible — concrete objects, layout, colours, any visible text. Do NOT mention the picture-as-an-object (no \\"the image\\" / \\"the picture\\" / \\"the source\\").",',
      '  "key_features": ["short bullet 1", "short bullet 2", "..."],',
      '  "suggested_topic": "max 30-char title for the canvas (subject-first, no meta words)",',
      '  "search_queries": ["focused query 1 about the subject", "query 2", "query 3"]',
      '}',
      '```',
      '',
      `## Rules`,
      '- `subject` and `suggested_topic` describe what is PICTURED — never refer to the picture-as-an-object.',
      '- `search_queries` should help fetch encyclopedia-grade facts ABOUT THE SUBJECT (history, anatomy, recipe, geography, etc.). Do NOT include words like "image", "photo", "diagram of", or filenames.',
      ...(sceneRule ? [`- ${sceneRule}`] : []),
      `- ${langDirective}`,
      '',
      '## Output JSON only. No backticks. No commentary.',
    ].join('\n');
  }

  let parsed;
  try {
    const r = await callOnce({ prompt: buildPrompt({ sceneOnly: false }), tag: 'describe-seed' });
    parsed = r.parsed;
  } catch (e) {
    // First attempt refused (often "identifiable person / privacy"). Retry
    // in scene-only mode so we still extract the setting/landmark/objects
    // — keeping the text-to-image fallback related to the upload instead
    // of a topic-only guess.
    log.warn(`[describe-seed] failed: ${e?.message} — retrying scene-only`);
    try {
      const r2 = await callOnce({ prompt: buildPrompt({ sceneOnly: true }), tag: 'describe-seed-scene' });
      parsed = r2.parsed;
    } catch (e2) {
      log.warn(`[describe-seed] scene-only retry also failed: ${e2?.message}`);
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    subject: safeStr(parsed.subject, 120).trim(),
    description: safeStr(parsed.description, 1000).trim(),
    key_features: safeStrArr(parsed.key_features, 8, 120),
    suggested_topic: safeStr(parsed.suggested_topic, 60).trim(),
    search_queries: safeStrArr(parsed.search_queries, 4, 120),
  };
}
