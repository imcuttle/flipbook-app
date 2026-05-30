export function normalizeLang(lang) {
  return lang === 'en' ? 'en' : 'zh';
}

export function languageInstruction(lang) {
  return normalizeLang(lang) === 'en'
    ? 'Default user language: English. Use English for every user-visible output by default: title, caption, hotspot labels, click labels, search queries, image_prompt wording, visible labels and annotations inside the generated image, and any user-facing refusal or repair rationale. HOWEVER, if the topic, current label, or any user note explicitly requests a specific language (e.g. "explain in Chinese", "用中文"), that explicit request OVERRIDES this default — follow the language the user asked for.'
    : '默认用户语言: 中文。默认情况下所有用户可见输出都使用中文: 标题、说明文字、热点标签、点击标签、搜索查询、image_prompt 的内容、生成图片内的可见标签和标注、以及面向用户的拒绝/修复说明。但是,如果主题、当前标签或用户备注中明确要求了某种语言(例如"用英文讲解"、"explain in English"),则以用户明确要求的语言为准,覆盖此默认值。';
}

export function imageLanguageInstruction(lang) {
  return normalizeLang(lang) === 'en'
    ? 'By default, all visible labels, captions, callouts, headings, and annotations inside the generated image must be in English — unless the topic/prompt explicitly requests another language, in which case follow that.'
    : '默认情况下生成图片中的所有可见标签、说明、指示线文字、分区标题和标注都必须使用中文;但若主题/提示中明确要求了其他语言,则以该要求为准。';
}
