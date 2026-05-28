# Flipbook Canvas — System Style Constraints

All canvases share these constraints:

- **Visual style**: isometric cutaway illustration, slight elevated angle (~30°), fine line work, muted natural colors
- **Background**: soft beige (#F5EFE6) or off-white; never pure white, never dark
- **Composition**: single coherent 16:9 (1920×1080) scene with 5+ distinct visual zones
- **In-image text annotations are EXPECTED and should be RICH**:
  - Each visual zone carries:
    - **1 short heading** (2–6 words / 字 in the user's language) labelling the zone, like a diagram section title.
    - **2–4 small callouts** pointing at sub-objects with concise labels (1–5 words each). Numeric/measurement callouts are encouraged where relevant ("200°C", "1397年", "25g/300ml", "120 m").
  - Aim for **20–40 short text fragments** in the whole scene — this is a dense annotated diagram, not a sparse poster.
  - Type style: clean sans-serif, dark grey or black, small relative to the scene; place near the object with a thin pointer line, or inside a small white pill if the background is busy.
  - Hard rules: NO paragraphs, NO taglines, NO sentences ≥ 8 words, NO brand logos, NO watermarks. Keep every fragment short.
- **Consistency**: every page in the same flipbook must feel like the same illustrator drew it.

Append the following suffix to **every** ImageGen prompt:
> `, isometric cutaway illustration, soft beige background (#F5EFE6), fine line work, muted natural colors, dense diagram-style text annotations: each zone has a 2-6 word heading plus 2-4 small callout labels (1-5 words each, sans-serif, dark grey, small relative to the scene), aim for 20-40 short text fragments total, viewed from a slight elevated angle, 16:9 composition`

Negative cues (if model supports):
> `paragraphs, long sentences, dense body copy, watermarks, brand logos, advertising taglines, harsh shadows, photorealistic`
