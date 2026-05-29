# Flipbook Canvas — Click-to-Label Prompt

The user has clicked a point on a flipbook image. Given:
- `parent_image_prompt` — the description used to GENERATE the parent image (this tells you what is roughly at each position)
- `parent_title` and `parent_caption`
- `click_xy` — normalized [x, y] in [0..1], where x grows right and y grows down
- `nearby_text` — array of OCR'd in-image text fragments **near the click**, each with `{text, xy, dist}` where `xy` is the fragment's centre (image-relative) and `dist` is its distance to `click_xy`. **This is the strongest signal of what the user actually clicked on** — it's text the model literally painted next to that pixel. Use it as the primary anchor for inferring the label, and only fall back to `parent_image_prompt` when this list is empty.
- `existing_labels` — array of `{label, anchor_xy, leader_xy}` already on this image

Your job is to:

1. **Infer what visual element the user clicked**, in this priority order:
   1. If `nearby_text` is non-empty, the closest 1–3 fragments (smallest `dist`) almost certainly describe the clicked subject. Treat them as ground truth and synthesise a concrete drillable noun phrase from them. Do NOT pick a subject from a different region just because it sounds richer.
   2. Otherwise, fall back to figuring out which zone of `parent_image_prompt` covers `click_xy` and pick the most specific drillable noun there.
2. **Decide where to place the new HTML label card** so it does not overlap `existing_labels`. Cards are ~240px wide; keep `anchor_xy` away from existing anchors by at least 0.18 in either x or y. The card should be near (but not on top of) the click point.
3. **Pick the leader endpoint** as the click point itself or the nearest visual feature, so the leader line clearly connects card → click.

## Output: STRICT JSON

```json
{
  "label": "max 50 chars, in the user's language; concrete drillable noun phrase",
  "anchor_xy": [0.0..1.0, 0.0..1.0],
  "leader_xy": [0.0..1.0, 0.0..1.0],
  "next_prompt": "one-sentence seed describing what the child page's image_prompt should depict — same language as label"
}
```

## Rules

- `label` is in the SAME language as `parent_title` (Chinese stays Chinese, English stays English).
- `label` must be a **concrete noun phrase** describing what was clicked, NOT a category like "details" or "more info".
- When `nearby_text` is provided, `label` must be consistent with the closest fragment(s). E.g. if the closest fragment is "洪都鸡", the label must be about chickens / 洪都鸡 / its dish, not about an unrelated zone the prose mentions.
- `anchor_xy` is the top-left of the card. Keep it inside [0.02, 0.85] for x and [0.04, 0.86] for y so the card stays visible. Spread away from `existing_labels[].anchor_xy` by ≥ 0.18 in at least one axis.
- `leader_xy` should be at or very near `click_xy` (within 0.05). Different from `anchor_xy`.
- `next_prompt` is the seed for the child node's image_prompt (one sentence, user language, 5-zone friendly).

## Output JSON only. No backticks. No commentary.
