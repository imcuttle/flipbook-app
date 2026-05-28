// Stub planner — used when ENABLE_CODEBUDDY=0. Produces deterministic title/caption/image_prompt.
// In the new model, planners no longer produce hotspots — those come from user clicks.
function isCJK(s) { return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s || ''); }

export function stubPlannerOutput({ topic, currentLabel, sources = [] }) {
  const subject = (currentLabel || topic || 'topic').toString().trim();
  const cn = isCJK(subject);
  const title = cn
    ? `${subject}：可视画布(占位)`
    : `${subject}: visual canvas (stub)`;
  const refsLine = sources.length
    ? cn
      ? `参考来源 ${sources.length} 条已附加在节点中。`
      : `${sources.length} reference link(s) attached.`
    : '';
  const caption = cn
    ? `占位画布:点击图片任意位置,生成对应的子主题。这是一段更长的占位描述,用于占位测试 caption 在 150–220 字范围内的渲染效果——本节点暂未启用真实 LLM,所有内容均为模板。${refsLine}`.slice(0, 220)
    : `Placeholder canvas — click anywhere on the image to drill into a sub-topic. This is a longer placeholder caption to exercise the 150–220 character target range of the encyclopedia register. ${refsLine}`.slice(0, 220);
  const imagePrompt = cn
    ? `等距剖面图,以"${subject}"为中心,5+ 个彼此区分的可点击区域,每区域含多种小物件,信息密集,每个区域附 1-4 个字的简短中文标注(如"核心结构""历史演变"等)`
    : `Isometric cutaway scene focused on "${subject}", 5+ distinct clickable zones, dense small objects, each zone carries a short 1-4 word diagram label (e.g. "core structure", "history")`;
  return { title, caption, image_prompt: imagePrompt, _stub: true };
}

// Stub label inference for click-to-label when codebuddy is disabled.
export function stubClickLabel({ click_xy, existing_labels = [], parent_title }) {
  const cn = isCJK(parent_title || '');
  const idx = existing_labels.length + 1;
  const seedNouns = cn
    ? ['细节区', '关键点', '边缘元素', '中心结构', '隐藏特征']
    : ['Detail zone', 'Key element', 'Edge feature', 'Central structure', 'Hidden facet'];
  const baseLabel = seedNouns[idx % seedNouns.length];
  const label = cn ? `${baseLabel} ${idx}` : `${baseLabel} ${idx}`;
  // Place anchor offset from click so the card doesn't cover the click point
  const [cx, cy] = click_xy;
  const dx = cx < 0.5 ? 0.12 : -0.18;
  const dy = cy < 0.5 ? 0.10 : -0.14;
  let ax = Math.max(0.02, Math.min(0.78, cx + dx));
  let ay = Math.max(0.04, Math.min(0.84, cy + dy));
  // Push away from existing anchors
  for (const e of existing_labels) {
    const ex = e.anchor_xy?.[0] ?? 0;
    const ey = e.anchor_xy?.[1] ?? 0;
    if (Math.abs(ax - ex) < 0.18 && Math.abs(ay - ey) < 0.12) {
      ay = Math.max(0.04, Math.min(0.84, ay + 0.18));
    }
  }
  return {
    label,
    anchor_xy: [ax, ay],
    leader_xy: [cx, cy],
    next_prompt: cn
      ? `围绕"${parent_title}"中"${label}"的细节展开,5+ 个可点击区域。`
      : `Drill into "${label}" from "${parent_title}", 5+ clickable zones.`,
    _stub: true,
  };
}
