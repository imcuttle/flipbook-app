# 🎨 Flipbook Canvas

**English** · [中文](./README.zh.md)

[![Node](https://img.shields.io/badge/Node.js-%E2%89%A520.10-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Sequelize-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Multimodal](https://img.shields.io/badge/Multimodal-LLM%20%C3%97%20ImageGen%20%C3%97%20WebSearch%20%C3%97%20OCR-FF6F61)](#-multimodal--mainstream-llms)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/imcuttle/flipbook-app/pulls)
[![GitHub stars](https://img.shields.io/github/stars/imcuttle/flipbook-app?style=social)](https://github.com/imcuttle/flipbook-app/stargazers)

> ✨ Click anywhere on a generated image. The backend infers what you clicked,
> searches the web when useful, generates a child diagram, and links it back.
> **A flipbook of explorable knowledge — one click at a time.**

> 💡 Inspired by and a re-implementation of the product idea behind
> [flipbook.page](https://flipbook.page) — credit to the original team for the
> click-to-explore canvas concept.

A long-running web product: **Express + SSE** backend, **Vite + React + TS**
frontend, a **pluggable multi-model image pipeline**, web-search augmented
planning, per-node concurrency, read-only share links, fullscreen casting and
a fully responsive mobile layout.

---

## ✨ Why this is fun

Most "AI画图" demos stop at one image. This one turns each image into a
**playable knowledge surface**:

- 🖱️ **Long-press anywhere on a picture** → the model reads what's under your
  finger, decides whether the topic needs fresh sources, optionally hits the
  web, then paints a brand new annotated diagram zoomed into that concept.
- 📚 **Encyclopedia-style output** — every node ships with a 150–220-char
  caption and 20–40 in-image labels (place names, dates, numbers…), all
  OCR'd back into a transparent text layer so you can drag-select and copy
  any fragment straight off the picture.
- 🌳 **Infinite tree of canvases** — every click spawns a child node; the
  whole exploration tree is persisted, shareable, and replayable.

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./docs/assets/demo.gif" alt="Click-to-explore demo" />
      <br/><sub><b>Click-to-explore</b> — long-press any region to drill in</sub>
    </td>
    <td align="center" width="50%">
      <img src="./docs/assets/woodpecker.gif" alt="Woodpecker walkthrough" />
      <br/><sub><b>End-to-end pipeline</b> — search → planner → ImageGen → drill-down</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="./docs/assets/screenshot.png" alt="Gallery and canvas" />
      <br/><sub><b>Gallery + canvas</b> — every canvas is persisted, shareable, replayable</sub>
    </td>
  </tr>
</table>

---

## 🚀 Highlights

- 🖱️ **Click-to-explore**: long-press (1 s) anywhere on a node's image. The
  backend infers the label, decides whether to web-search, then generates a
  child node. Spatial + semantic dedup means clicking the same region again
  jumps straight in.
- ⚡ **Per-node parallelism**: up to **4 different spots in parallel per parent**
  (configurable). Each in-flight click streams a phase chip
  (`Inferring label…` → `Searching the web…` → `Generating image…`) on the
  hotspot. Hit the cap and the cursor turns into ⌛.
- 📖 **Encyclopedia register**: planner produces 150–220 char captions with
  20–40 in-image text fragments — like reading a richly annotated diagram in
  a children's encyclopedia.
- 🌐 **Web-search augmented**: a "decide-then-search" gate asks the LLM whether
  a topic benefits from up-to-date sources. When yes, results are fetched and
  fed into the planner; sources are persisted to disk + DB and rendered as a
  📚 hover badge over the canvas.
- 🎬 **Scene transitions**: drill-in / drill-out / fade animations make
  navigation feel like a zooming flipbook rather than a page swap.
- 🔗 **Share as preview**: any canvas → read-only `?s=<token>` URL. Viewers can
  navigate and watch live SSE updates from in-flight generations, but cannot
  trigger new ones.
- 📺 **Fullscreen casting**: ⛶ requests browser fullscreen; toggle the chrome
  (breadcrumb + caption + hint) on/off for a clean projection view.
- 🔤 **Selectable in-image text**: every label baked into the diagram is OCR'd
  with Apple Vision (`zh-Hans` + `en-US`) and overlaid as invisible HTML, so
  users can drag-select and Cmd-C copy any text directly off the picture
  while the painted pixels remain the visual ground truth.
- 📱 **Mobile responsive**: top bar collapses to icons, single-column gallery,
  smaller hotspots and pending bubbles.

---

## 🤖 Multimodal × Mainstream LLMs

Flipbook Canvas is built around a **pluggable multimodal pipeline**. Three
modalities are wired end-to-end:

| Modality | What it does | Pluggable into |
|---|---|---|
| 📝 **Text / JSON LLM** | planner, click-label inference, decide-then-search verdict | any chat-completion-style model |
| 🖼️ **Image generation** | turns a structured prompt into a 2752×1536 annotated diagram with bake-in text labels | OpenAI, Nano Banana (Gemini), Seedream/Seeddance, or your own provider |
| 🌐 **Web search** | rephrased query → top-N normalized results → planner context + 📚 sources panel | any search backend |
| 👁️ **OCR (Apple Vision)** | `zh-Hans` + `en-US` recognition over every generated PNG, projected as a selectable HTML overlay | local, no API keys needed |

The image layer is a **provider chain** (`IMAGE_PROVIDER=...,svg`) — first
enabled provider wins, `svg` is always appended last as a placeholder so the
UI never breaks. Adding a new model is a single file:

```js
// server/src/generation/providers/<name>.js
export default {
  name: 'my-model',
  enabled(config) { return Boolean(config.MY_API_KEY); },
  async generate({ imagePrompt, outputDir, size, title, hash, onEvent }) {
    // call your model, write <hash>.png into outputDir, push phase events
  },
};
```

Out of the box:

| Provider | Trigger to enable | Status |
|---|---|---|
| `openai` | `OPENAI_API_KEY` set | 🔌 stub — implement in `providers/openai.js` |
| `nanobanana` | `NANOBANANA_API_KEY` or `GEMINI_API_KEY` | 🔌 stub |
| `seeddance` | `SEEDDANCE_API_KEY` or `ARK_API_KEY` | 🔌 stub |
| `codebuddy` | `ENABLE_CODEBUDDY=1` | ✅ reference impl (used in the demo gif) |
| `svg` | always | ✅ fallback placeholder |

> 🎯 The **reference implementation** wires the `codebuddy` CLI as a
> subprocess driver for planner / ImageGen / WebSearch. Subprocess lifecycle
> (concurrency cap, per-call timeouts, single retry, file-size sanity check on
> generated PNGs, graceful degradation) lives in `server/src/codebuddyClient.js`
> and is a useful template if you ever shell out to *any* CLI-based model.

---

## 🐦 Walkthrough — generating a woodpecker flipbook from zero

Type `啄木鸟` (woodpecker) into the top bar and watch the entire pipeline run:
decide-then-search → planner → ImageGen → click to drill into the tongue
anatomy / nest cavity / ant-foraging zones, each spawning its own annotated
diagram with its own sources.

---

## 🗂️ Layout

```
.
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
│       ├── store/                  # filesystem layer
│       ├── sse/                    # event hub
│       └── codebuddyClient.js      # reference CLI-subprocess wrapper
└── web/                            # Vite + React + TS
```

## 💾 Storage

- 📁 **Filesystem** (source of truth for big artifacts):
  `server/data/canvases/<id>/{data/tree.json, data/nodes/<hash>.json, images/<hash>.{png,svg}, manifest.json}`.
- 🗃️ **SQLite** (`server/data/flipbook.sqlite`, via Sequelize): metadata index —
  Canvases / Nodes / Hotspots / ShareLinks / Sources tables. Drives the
  gallery, spatial dedup, share lookup, and sources hover panel. On boot the
  server runs `hydrateFromDisk()` to rebuild this index if it's missing.

## 🛠️ Develop

```bash
npm install
npm run dev           # server on :8787 + Vite on :5173 in parallel
```

Open http://127.0.0.1:5173.

By default `ENABLE_CODEBUDDY=0` (stub mode — fast, SVG placeholders, no LLM).
Set `ENABLE_CODEBUDDY=1` to use the reference CLI provider for planner +
ImageGen + WebSearch:

```bash
ENABLE_CODEBUDDY=1 npm run dev:server
```

> ⏱️ With the reference provider, each node takes ~70–95 s end-to-end (planner
> ~25 s + ImageGen ~50–60 s including cold start; +5–15 s if web search runs).
> ImageGen produces **2752×1536 PNG** (~6 MB).

### Per-node parallelism

Up to **4 click expansions per parent node** run in parallel; excess clicks
queue. Different parents and different canvases run independently. A
per-parent write lock serializes only the short read-modify-write of the
parent node JSON. Tunable via `MAX_PARALLEL_CLICKS_PER_NODE` (default 4).

## 🔍 Web search

A pre-planner gate (`decideSearch.js` + `prompts/decide-search.md`) calls the
LLM with the proposed subject and asks: do recent / authoritative sources
materially improve this node? The default leans **yes** — only clearly
abstract / timeless subjects skip search. When yes:

1. The web-search backend runs with the rephrased query.
2. Results are normalised into `{title, url, snippet, source}`.
3. Top results are passed into the planner prompt.
4. Sources are persisted both into `nodes/<hash>.json` and into the SQLite
   `Sources` table.
5. The frontend renders a 📚 badge near the breadcrumb. Hover to see a popover
   with the source list (220 ms grace period so the popover is reachable with
   the mouse).

## 🔗 Share / preview links

- `POST /api/canvas/:id/share` → `{token, url}`. Reuses an existing token for
  the same canvas.
- `GET /api/share/:token` → `{canvasId, topic, readOnly:true}`.
- Frontend: opening `…?s=<token>` puts the UI in **read-only preview** mode —
  no topic input, no clicks on the image, "👁 Preview" badge in the corner.
  SSE stays connected, so a viewer watching mid-generation sees images stream
  in real-time.

## 📺 Fullscreen / casting

- `⛶` button in TopBar requests browser fullscreen; uses CSS-only fullscreen
  on iOS Safari where the API isn't supported.
- `👁` / `🚫` button (visible while in fullscreen) toggles the breadcrumb +
  caption + hint. Useful for clean projection.
- Long-press hint is suppressed in fullscreen by default; the press still
  works.

## 🧹 Cleaning local state

```bash
npm run clean:data    # reset server/data (all canvases)
npm run clean:dist    # reset web/dist
npm run clean         # both
```

## 📦 Build for production

```bash
npm run build         # builds web/dist
npm start             # serves web/dist + API from :8787
```

## 🌐 LAN access via a fixed domain (macOS)

Give the app a stable hostname (e.g. `http://flipbook.lan`) reachable from any
device on your LAN — no port number needed. Uses **dnsmasq** (resolves the
domain → this machine's LAN IP) + **Caddy** (reverse-proxies `:80` to the app).

```bash
npm run lan:up        # flipbook.lan → dev :5173 (preferred), falls back to prod :8787
npm run lan:down      # tear it down

# custom: scripts/lan-domain-setup.sh <domain> <devPort> <prodPort>
bash scripts/lan-domain-setup.sh studio.lan 5173 8787
```

The proxy tries the **dev** port (5173) first and automatically **falls back to
the prod** port (8787) when dev isn't running (passive health check, 3s
blacklist). So `npm run dev` and `npm start` both work behind the same domain.

`lan:up` installs dnsmasq/caddy via Homebrew if missing and needs `sudo`
(dnsmasq binds 53, Caddy binds 80). It only configures **this** machine; to
reach the domain from other devices, point their DNS at this machine's LAN IP
(router DHCP DNS, per-device DNS, or a `hosts` entry — the script prints the
exact options and your IP).

## ⚙️ Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 8787 | server port |
| `HOST` | 127.0.0.1 | server bind |
| `DATA_DIR` | `server/data` | canvas state on disk |
| `PROMPTS_DIR` | `prompts` | prompt files |
| `DB_PATH` | `<DATA_DIR>/flipbook.sqlite` | SQLite file |
| `MAX_PARALLEL_CLICKS_PER_NODE` | 4 | concurrent click expansions per parent |
| `PLANNER_TIMEOUT_MS` | 90000 | per-call planner timeout |
| `IMAGE_TIMEOUT_MS` | 180000 | per-call ImageGen timeout |
| `WEB_SEARCH_TIMEOUT_MS` | 60000 | per-call WebSearch timeout |
| `IMAGE_PROVIDER` | `codebuddy` | provider chain (e.g. `openai,nanobanana,svg`) |
| `IMAGE_SIZE` | `1920x1080` | requested size (provider may pick its own) |
| `ENABLE_CODEBUDDY` | 0 | flip to 1 to enable the reference CLI provider |
| `ENABLE_WEB_SEARCH` | follows `ENABLE_CODEBUDDY` | force-disable with `0` |
| `ENABLE_OCR` | 1 | run Apple Vision OCR on each generated PNG to produce a selectable text overlay; set to `0` to skip |
| `OCR_TIMEOUT_MS` | 25000 | per-call OCR timeout |
| `OCR_MIN_CONFIDENCE` | 0.4 | drop OCR spans below this confidence |

---

**English** · [中文](./README.zh.md)
