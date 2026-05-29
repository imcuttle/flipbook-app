# Image-extend addendum (when `has_seed_image` is true)

A user-supplied source image is attached to this prompt. The flipbook page you generate must be a **stylised, annotated derivative** of that image — NOT a brand-new scene about the topic.

## Hard rules — preserve the original

- **Subject**: do not replace the central subject. If the image shows a kitchen, the new image must show that same kitchen. If it shows a bird, that same bird species and pose.
- **Composition**: same camera angle, same vertical/horizontal alignment, same zone layout. The user's image already has visual zones — name and label THOSE zones, don't invent new ones.
- **Framing**: keep the dominant elements roughly where they were in the source. The annotated diagram should feel like the user's original picture with explanatory labels drawn over it, not like a different illustration of the same topic.
- **Identity**: if the source has any distinctive features (colour palette, decorative motifs, text already painted in), reference them in `image_prompt` so the generator preserves them.

## What you DO change

- **Style**: convert to the project's encyclopedia / isometric-cutaway register (fine line work, soft beige background, muted natural colors, slight elevated angle).
- **Annotations**: add 20–40 short text fragments (zone headings 2–6 字 + 2–4 callouts per zone, 1–5 字 each) labelling what's already in the source. Place callouts pointing at sub-objects already visible in the user's image.
- **Encyclopedia caption**: 150–220 字 dense factual prose grounded in the actual content of the user's image (and any `sources` if present). Do NOT invent details that contradict what's clearly visible.

## image_prompt structure when has_seed_image=true

Open with an explicit re-anchoring sentence such as:

> "Restyled annotated diagram of the source image (preserve composition, subject, and layout): [brief description of what the source shows]. Add the following labels:..."

Then list the zone headings + callout labels per zone. Keep the visual cues (colours, materials, textures) consistent with the source so the image-to-image edit doesn't drift away from the original.

## Title and caption

- `title` should reference the actual subject of the source image (not just the canvas's `topic`).
- `caption` describes the source's content with encyclopedia register, weaving in any `sources` facts that match. Avoid generic prose; cite specifics that are visible in the user's image.