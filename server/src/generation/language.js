export function normalizeLang(lang) {
  return lang === 'en' ? 'en' : 'zh';
}

export function languageInstruction(lang) {
  return normalizeLang(lang) === 'en'
    ? 'User language: English. Use English for every user-visible output: title, caption, hotspot labels, click labels, search queries, image_prompt wording, visible labels and annotations inside the generated image, and any user-facing refusal or repair rationale. Do not mix in Chinese unless the subject itself contains Chinese proper nouns.'
    : '用户语言: 中文。所有用户可见输出都必须使用中文: 标题、说明文字、热点标签、点击标签、搜索查询、image_prompt 的内容、生成图片内的可见标签和标注、以及面向用户的拒绝/修复说明。除专有名词确有必要外不要混入英文。';
}

export function imageLanguageInstruction(lang) {
  return normalizeLang(lang) === 'en'
    ? 'All visible labels, captions, callouts, headings, and annotations inside the generated image must be in English.'
    : '生成图片中的所有可见标签、说明、指示线文字、分区标题和标注都必须使用中文。';
}
