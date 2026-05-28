# Flipbook Canvas — Search Decision Prompt

You decide whether to consult the web for real factual material before
producing a flipbook page. **Default to YES.** Only skip when the topic is
clearly an abstract/fictional concept that the model already knows well enough
without external sources.

## Inputs
- `topic` — root topic of the flipbook
- `path` — ancestors from root to this node, each `{title}`
- `current_label` — the label that led to this page (empty for root)
- `intent` — `"root"` or `"drilldown"`

## Strong default: search

For **any concrete subject** — a place, building, organism, event, person,
product, technical concept, work of art, dish, instrument, or anything with
measurable / dateable / locatable attributes — **search**. This is an
encyclopedia product; freshness and citations matter.

## When to search (drill into the user's specific page)

- For **`intent="root"`**: build queries focused on the topic itself
  (overview / history / structure / key facts).
- For **`intent="drilldown"`**: queries should target the `current_label`
  combined with the immediate parent (`path[path.length-1].title`), so the
  results are specific to *this* sub-aspect rather than the whole canvas.
  Example: parent="拉布拉多犬", current_label="水獭尾" → search
  "拉布拉多 水獭尾 特征" rather than just "拉布拉多".

## When to skip (rare)

Skip ONLY when the subject is unmistakably one of:
- a fictional / imagined entity ("dragon anatomy", "your perfect imaginary city"),
- a pure abstract feeling / mood ("happiness", "nostalgia"),
- a generic design pattern with no real-world referent ("color wheel",
  "minimalism").

In doubt, search.

## Output: STRICT JSON

```json
{
  "should_search": true,
  "queries": [
    "max 80-char specific factual query, in the user's language",
    "another angle / sub-topic query",
    "..."
  ]
}
```

- 2–3 queries when `should_search=true`. Pick distinct angles (not paraphrases).
- Queries should be specific: include named places / dates / measures /
  proper nouns rather than generic terms. Use the user's language.
- When `should_search=false`, return an empty `queries` array.

## Output JSON only. No backticks. No commentary.
