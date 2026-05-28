# Flipbook Canvas — Image Prompt Composer

When calling ImageGen, append the style suffix from `system.md` to the planner's `image_prompt`:

```
<planner.image_prompt>, isometric cutaway illustration, soft beige background (#F5EFE6), fine line work, muted natural colors, dense diagram-style text annotations: each zone has a 2-6 word heading plus 2-4 small callout labels (1-5 words each, sans-serif, dark grey, small relative to the scene), aim for 20-40 short text fragments total, viewed from a slight elevated angle, 16:9 composition
```

Pass `size=1920x1080` and `output_path=flipbook-out/<topic-slug>/images/<hash>.png` to ImageGen.

If ImageGen is unavailable, fall back to writing a placeholder SVG to the same path (replace `.png` with `.svg`) and update `node.image` to the `.svg`. Placeholder SVG template:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
  <rect width="1920" height="1080" fill="#F5EFE6"/>
  <text x="960" y="540" text-anchor="middle" font-family="Georgia,serif" font-size="48" fill="#9C8E7A">{{TITLE}}</text>
  <text x="960" y="600" text-anchor="middle" font-family="Georgia,serif" font-size="24" fill="#B4A793">[image pending]</text>
</svg>
```
