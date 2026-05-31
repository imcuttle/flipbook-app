# Image-extend addendum (when `has_seed_image` is true)

A user-supplied source image is attached to this prompt. The flipbook page you generate must be a **stylised, annotated derivative** of that image — NOT a brand-new scene about the topic.

## Hard rules — preserve the original

- **Subject**: do not replace the central subject. If the image shows a kitchen, the new image must show that same kitchen. If it shows a bird, that same bird species and pose.
- **Composition**: same camera angle, same vertical/horizontal alignment, same zone layout. The user's image already has visual zones — name and label THOSE zones, don't invent new ones.
- **Framing**: keep the dominant elements roughly where they were in the source. The annotated diagram should feel like the user's original picture with explanatory labels drawn over it, not like a different illustration of the same topic.
- **Identity**: if the source has any distinctive features (colour palette, decorative motifs, text already painted in), reference them in `image_prompt` so the generator preserves them.

## Critical — never refer to the picture-as-an-object

The reader must not be aware that an upload exists. **NEVER write any of:**
- "the seed image", "the source image", "the original image", "the uploaded picture"
- "the image shows", "the image depicts", "this image", "the picture"
- "as seen in the image", "from the image", "based on the image"

Instead, write directly about the SUBJECT. If the image shows a pineapple bun, the caption is about the pineapple bun (its history, ingredients, technique, etc.) — not about "the image of a pineapple bun".

If the prompt provides a `seed_subject` and `seed_description`, those are FACTS about the subject — incorporate them as if you'd looked up the subject yourself, not as meta-narration.

## Honour the user's `user_note` as a focus / note

`user_note` (when present) is the user's instruction about THIS image — often a **focus** (e.g. "只讲解图里左下角的旗杆" / "重点说这道菜的食材") or a tone/audience note ("讲给小朋友听"). When it reads as a focus:
- KEEP the seed image's subject and composition (the hard rules above still apply), but
- BIAS the title, caption emphasis, and the densest annotations toward the part / aspect `user_note` calls out. If it points at a specific region, make that region the focal zone with the richest callouts.
- If `user_note` is just a tone/audience note, fold it into the register/scope; don't print it literally.
Never echo `user_note` verbatim as the title.

## What you DO change

- **Style**: convert to the project's encyclopedia / isometric-cutaway register (fine line work, soft beige background, muted natural colors, slight elevated angle).
- **Annotations**: add 40–70 short text fragments (zone headings 2–6 字 + 4–6 callouts per zone, 1–6 字 each, with frequent numbers/dates/measurements) labelling what's already in the source. Place callouts pointing at sub-objects already visible in the user's image — pack the page densely like a detailed infographic.
- **Encyclopedia caption**: 150–220 字 dense factual prose about the SUBJECT (drawing on `seed_description`, `seed_features`, and any `sources`). Cite specifics (years, names, measurements) as if writing a museum placard for the subject. Do NOT mention that an image was supplied.

## image_prompt structure when has_seed_image=true

Open with an explicit re-anchoring sentence such as:

> "Annotated isometric diagram of [SUBJECT] preserving the original composition: [list the zones already in the source — center / left / right / top / bottom]. Add the following labels:..."

Then list the zone headings + callout labels per zone. Keep the visual cues (colours, materials, textures) consistent with the source so the image-to-image edit doesn't drift away from the original.

## Title

`title` should name the SUBJECT directly (e.g. "菠萝包·港式麵包經典", not "Source image: Pineapple bun"). Max 60 chars.