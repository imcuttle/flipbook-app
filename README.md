# Flipbook Canvas — CS App

**English** · [中文](./README.zh.md)

> Click anywhere on a generated image. The backend infers what you clicked,
> searches the web if useful, generates a child diagram, and links it back.
> A flipbook of explorable knowledge — one click at a time.

> Inspired by and a re-implementation of the product idea behind
> [flipbook.page](https://flipbook.page) — credit goes to the original team
> for the click-to-explore canvas concept.

![Flipbook Canvas demo](./docs/assets/demo.gif)

A long-running web product version of the `flipbook-canvas` skill: Express + SSE
backend, Vite + React frontend, pluggable image providers (codebuddy CLI by
default; OpenAI / Nano Banana / Seedream stubs ready for keys), web-search
augmented planner, per-node concurrency, read-only share links, fullscreen
casting and a fully responsive mobile layout.

> **Scope reminder**: localhost only, no built-in auth, `?n=<canvasId>` /
> `?s=<shareToken>` are the only access tokens. Don't expose this beyond your
> own machine.

---

## Built on CodeBuddy — a CodeBuddy good case

This project is a showcase of **using the [CodeBuddy](https://cnb.cool/codebuddy/codebuddy-code) CLI as a runtime dependency**, not just as a coding assistant. The entire knowledge-generation pipeline is driven by spawning `codebuddy` as a subprocess and consuming its stream-json output:

- **CodeBuddy is a hard runtime requirement when `ENABLE_CODEBUDDY=1`** — the server resolves `CODEBUDDY_BIN` (default: `codebuddy`) and shells out to it for every node. No CodeBuddy on `$PATH`, no real generation. (Stub mode with `ENABLE_CODEBUDDY=0` is provided for local UI work and CI.)
- **Three CodeBuddy capabilities are wired into the pipeline:**
  - `codebuddy --print --output-format json` for the **planner** (`server/src/generation/planner.js`) and **decide-then-search gate** (`generation/decideSearch.js`) — text/JSON one-shot calls that produce captions, click labels, and the search-or-not verdict.
  - `codebuddy --print --output-format stream-json --input-format stream-json` for **ImageGen** (`generation/providers/codebuddy.js`) — the model is asked to invoke its built-in `ImageGen` tool, and we stream phase events back to the frontend over SSE as they arrive on stdout.
  - `codebuddy WebSearch` for **web-augmented planning** (`generation/webSearch.js`) — results are normalised, fed into the planner prompt, and persisted as 📚 sources alongside each node.
- **Subprocess lifecycle is handled in `server/src/codebuddyClient.js`:** every spawn passes `-y` (`--dangerously-skip-permissions`), a `Semaphore` caps concurrent CodeBuddy processes (`MAX_PARALLEL_CODEBUDDY`, default 2), every call has a typed timeout (`PLANNER_TIMEOUT_MS` / `IMAGE_TIMEOUT_MS` / `WEB_SEARCH_TIMEOUT_MS`), and each call gets one retry before surfacing a typed error. Image generation additionally `fs.stat`s the output file (≥ 512 B) to defend against the silent-failure pattern.
- **Fallback chain when CodeBuddy isn't available:** `IMAGE_PROVIDER` is a comma-separated chain (e.g. `codebuddy,openai,svg`); `svg` is always appended as the last-resort placeholder so the UI never breaks even if every upstream provider fails.

If you're evaluating CodeBuddy as a backend dependency for an interactive product, this app is meant to be a reference for **how to spawn it, stream from it, cap it, time it out, and gracefully degrade when it's gone**.

---

## Highlights

- **Click-to-explore**: long-press (2 s) anywhere on a node's image. The
  backend infers the label, decides whether to web-search, then generates a
  child node. Spatial + semantic dedup means clicking the same region again
  jumps straight in.
- **Per-node parallelism**: up to **4 different spots in parallel per parent**
  (configurable). Each in-flight click streams a phase chip
  (`Inferring label…` → `Searching the web…` → `Generating image…`) on the
  hotspot. Hit the cap and the cursor turns into ⌛.
- **Encyclopedia register**: planner produces 150–220 char captions with
  20–40 in-image text fragments — like reading a richly annotated diagram in
  a children's encyclopedia.
- **Web-search augmented**: a "decide-then-search" step asks the LLM whether a
  topic benefits from up-to-date sources. When yes, results are fetched and
  fed into the planner; sources are persisted to disk + DB and rendered as a
  📚 hover badge over the canvas.
- **Scene transitions**: drill-in / drill-out / fade animations make
  navigation feel like a zooming flipbook rather than a page swap.
- **Share as preview**: any canvas → read-only `?s=<token>` URL. Viewers can
  navigate and watch live SSE updates from in-flight generations, but cannot
  trigger new ones.
- **Fullscreen casting**: ⛶ requests browser fullscreen; toggle the chrome
  (breadcrumb + caption + hint) on/off for a clean projection view.
- **Mobile responsive**: top bar collapses to icons, single-column gallery,
  smaller hotspots and pending bubbles.

![Gallery and canvas](./docs/assets/screenshot.png)

## Walkthrough — generating a woodpecker flipbook from zero

Type `啄木鸟` (woodpecker) into the top bar and watch the entire pipeline run:
decide-then-search → planner → ImageGen → click to drill into the tongue
anatomy / nest cavity / ant-foraging zones, each spawning its own annotated
diagram with its own sources.

![Generating a woodpecker flipbook from scratch](./docs/assets/woodpecker.gif)

---

## Layout

```
app/
├── prompts/                        # system / planner / click-label / image-prompt / decide-search
├── scripts/sync-prompts.mjs
├── server/
│   └── src/
│       ├── routes/                 # canvas, click, events (SSE), assets, share
│       ├── generation/
│       │   ├── pipeline.js         # generateRoot + expandFromClick + per-node concurrency
│       │   ├── decideSearch.js     # decide-then-search gate
│       │   ├── webSearch.js        # WebSearch subprocess + result normaliser
│       │   ├── queue.js            # PerCanvasQueue / Semaphore / PerKeySemaphore
│       │   ├── planner.js / clickLabel.js
│       │   ├── image.js            # provider-chain orchestrator
│       │   └── providers/          # codebuddy, openai, nanobanana, seeddance, svg
│       ├── db/                     # Sequelize models + hydrateFromDisk
│       ├── store/                  # filesystem layer (mirrors skill format)
│       ├── sse/                    # event hub
│       └── codebuddyClient.js      # codebuddy CLI subprocess wrapper
└── web/                            # Vite + React + TS
```

## Storage

- **Filesystem** (source of truth for big artifacts):
  `server/data/canvases/<id>/{data/tree.json, data/nodes/<hash>.json, images/<hash>.{png,svg}, manifest.json}`.
  Byte-compatible with the static-site skill's `init.mjs` output.
- **SQLite** (`server/data/flipbook.sqlite`, via Sequelize): metadata index —
  Canvases / Nodes / Hotspots / ShareLinks / Sources tables. Drives the
  gallery, spatial dedup, share lookup, and sources hover panel. On boot the
  server runs `hydrateFromDisk()` to rebuild this index if it's missing.

## Develop

```bash
cd app
npm install
npm run dev           # server on :8787 + Vite on :5173 in parallel
```

Open http://127.0.0.1:5173.

By default `ENABLE_CODEBUDDY=0` (stub mode — fast, SVG placeholders, no LLM).
Set `ENABLE_CODEBUDDY=1` to use the real codebuddy CLI for planner + ImageGen
+ WebSearch:

```bash
ENABLE_CODEBUDDY=1 npm run dev:server
```

### Real-codebuddy timing

- Each node takes ~70–95 s end-to-end (planner ~25 s + ImageGen ~50–60 s
  including cold start; +5–15 s if web search runs).
- ImageGen generates **2752×1536 PNG** (~6 MB); the model picks its own size
  regardless of `IMAGE_SIZE`.
- All codebuddy spawns use `-y` (`--dangerously-skip-permissions`).

### Per-node parallelism

Up to **4 click expansions per parent node** run in parallel; excess clicks
queue. Different parents and different canvases run independently. A
per-parent write lock serializes only the short read-modify-write of the
parent node JSON. Tunable via `MAX_PARALLEL_CLICKS_PER_NODE` (default 4).

## Image providers

Configured via `IMAGE_PROVIDER` env (comma-separated chain; first enabled
provider wins, `svg` is always appended last as the safety net):

| Provider | Trigger to enable |
|---|---|
| `codebuddy` | `ENABLE_CODEBUDDY=1` (default) |
| `openai` | `OPENAI_API_KEY` set; **stub — implement in providers/openai.js** |
| `nanobanana` | `NANOBANANA_API_KEY` or `GEMINI_API_KEY` set; **stub** |
| `seeddance` | `SEEDDANCE_API_KEY` or `ARK_API_KEY` set; **stub** |
| `svg` | always (fallback placeholder) |

Adding a new provider: create `server/src/generation/providers/<name>.js`
exporting `{name, enabled(config), generate({imagePrompt, outputDir, size, title, hash, onEvent})}`,
register it in `providers/index.js`. The orchestrator handles renaming the
produced file to `<hash>.png` for you.

## Web search

A pre-planner gate (`decideSearch.js` + `prompts/decide-search.md`) calls the
LLM with the proposed subject and asks: do recent / authoritative sources
materially improve this node? The default leans **yes** — only clearly
abstract / timeless subjects skip search. When yes:

1. `webSearch.js` runs `codebuddy WebSearch` with the rephrased query.
2. Results are normalised into `{title, url, snippet, source}`.
3. Top results are passed into the planner prompt.
4. Sources are persisted both into `nodes/<hash>.json` and into the SQLite
   `Sources` table.
5. The frontend renders a 📚 badge near the breadcrumb. Hover to see a popover
   with the source list (220 ms grace period so the popover is reachable with
   the mouse).

> **No sources showing up?** Two common causes:
> 1. **Stale server process** — `decideSearch.js` / `searchWeb.js` were edited
>    but the dev server wasn't restarted. `node --watch` only reloads if the
>    process is still alive; a killed server means new generations never run
>    the new code. Restart `npm run dev:server`.
> 2. **Old nodes** — sources are written when a node is *generated*. Existing
>    nodes from earlier server runs won't retroactively get sources. Click into
>    a fresh hotspot or start a new canvas to see them.

## Share / preview links

- `POST /api/canvas/:id/share` → `{token, url}`. Reuses an existing token for
  the same canvas.
- `GET /api/share/:token` → `{canvasId, topic, readOnly:true}`.
- Frontend: opening `…?s=<token>` puts the UI in **read-only preview** mode —
  no topic input, no clicks on the image, "👁 Preview" badge in the corner.
  SSE stays connected, so a viewer watching mid-generation sees images stream
  in real-time.

## Fullscreen / casting

- `⛶` button in TopBar requests browser fullscreen; uses CSS-only fullscreen
  on iOS Safari where the API isn't supported.
- `👁` / `🚫` button (visible while in fullscreen) toggles the breadcrumb +
  caption + hint. Useful for clean projection.
- Long-press hint is suppressed in fullscreen by default; the press still
  works.

## Cleaning local state

```bash
npm run clean:data    # rimraf server/data — DESTRUCTIVE, all canvases gone
npm run clean:dist    # rimraf web/dist
npm run clean         # both
```

> ⚠️ `server/data/` holds expensive LLM-generated artifacts. Don't wipe it
> casually — back up `canvases/` first if anything in there matters.

## Build for production

```bash
npm run build         # builds web/dist
npm start             # serves web/dist + API from :8787
```

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 8787 | server port |
| `HOST` | 127.0.0.1 | server bind |
| `DATA_DIR` | `server/data` | canvas state on disk |
| `PROMPTS_DIR` | `app/prompts` | prompt files |
| `DB_PATH` | `<DATA_DIR>/flipbook.sqlite` | SQLite file |
| `CODEBUDDY_BIN` | `codebuddy` | path to codebuddy executable |
| `MAX_PARALLEL_CODEBUDDY` | 2 | global subprocess cap |
| `MAX_PARALLEL_CLICKS_PER_NODE` | 4 | concurrent click expansions per parent |
| `PLANNER_TIMEOUT_MS` | 90000 | per-call planner timeout |
| `IMAGE_TIMEOUT_MS` | 180000 | per-call ImageGen timeout |
| `WEB_SEARCH_TIMEOUT_MS` | 60000 | per-call WebSearch timeout |
| `IMAGE_PROVIDER` | `codebuddy` | provider chain (e.g. `openai,codebuddy,svg`) |
| `IMAGE_SIZE` | `1920x1080` | requested size (provider may pick its own) |
| `ENABLE_CODEBUDDY` | 0 | flip to 1 to enable real generation |
| `ENABLE_WEB_SEARCH` | follows `ENABLE_CODEBUDDY` | force-disable with `0` |

## Disk format compatibility

`server/data/canvases/<canvasId>/` is byte-compatible with what the
static-site skill's `init.mjs` produces, so a finished canvas can be passed to
`skill/scripts/assemble.mjs` to export a static site. Conversely, dropping a
skill-generated folder into `server/data/canvases/` and restarting the server
will pick it up via `hydrateFromDisk()`.

---

**English** · [中文](./README.zh.md)
