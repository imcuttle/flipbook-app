# 🎨 Flipbook Canvas

[English](./README.md) · **中文**

[![Node](https://img.shields.io/badge/Node.js-%E2%89%A520.10-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Sequelize-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Multimodal](https://img.shields.io/badge/%E5%A4%9A%E6%A8%A1%E6%80%81-LLM%20%C3%97%20ImageGen%20%C3%97%20WebSearch%20%C3%97%20OCR-FF6F61)](#-多模态--主流大模型)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/imcuttle/flipbook-app/pulls)
[![GitHub stars](https://img.shields.io/github/stars/imcuttle/flipbook-app?style=social)](https://github.com/imcuttle/flipbook-app/stargazers)

> ✨ 在生成的图片上任意位置长按。后端会推断你点的是什么、必要时联网搜索资料、
> 生成一张子图并把它链回来。**一本可以"点出来"的可探索画册 —— 一次一个点击。**

> 💡 本项目基于 [flipbook.page](https://flipbook.page) 的产品理念设计与实现，
> "点击图片继续往下钻"的画布交互思路源自该产品，特此致谢原团队。

一个常驻 Web 产品：**Express + SSE** 后端、**Vite + React + TS** 前端、
**可插拔的多模型图像生成流水线**、联网搜索增强的 planner、按节点并发、只读
分享链接、全屏投屏，以及完整的移动端响应式布局。

> 🔒 **范围提醒**：仅本机使用，未内置鉴权。`?n=<canvasId>` / `?s=<shareToken>`
> 是唯一的访问凭据，请勿暴露到本机以外的环境。

---

## ✨ 为什么好玩

大多数"AI 画图"演示画完一张就结束了。这个项目把每一张图都变成一块**可玩的
知识表面**：

- 🖱️ **在图上任意位置长按** → 模型读懂你手指底下是什么、判断是否需要新资料、
  必要时联网检索，最后画出一张专门聚焦这个概念的全新带文字标注图。
- 📚 **百科图鉴风格** —— 每个节点都自带 150–220 字图说，配 20–40 处图内文字
  标注（地名、年份、数据 …），并通过 OCR 还原成透明文字层，用户可以在图上
  直接拖选、复制任意片段。
- 🌳 **画布是无限延伸的树** —— 每次点击都生成一个子节点；整棵探索树会被持久
  化、可分享、可回放。

---

## 📸 截图速览

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./docs/assets/demo.gif" alt="点击式探索演示" />
      <br/><sub><b>点击式探索</b> — 长按任意区域即可钻入</sub>
    </td>
    <td align="center" width="50%">
      <img src="./docs/assets/woodpecker.gif" alt="啄木鸟完整流水线" />
      <br/><sub><b>端到端流水线</b> — 搜索 → planner → ImageGen → 钻入</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="./docs/assets/screenshot.png" alt="画廊与画布" />
      <br/><sub><b>画廊 + 画布</b> — 每个画布都被持久化、可分享、可回放</sub>
    </td>
  </tr>
</table>

---

## 🚀 亮点

- 🖱️ **点击式探索**：在节点图上任意位置 **长按 2 秒**。后端推断你点击位置的
  语义标签、判断是否需要联网搜索、最终生成一个子节点。空间 + 语义双重去重，
  再次点击同一区域会直接跳进去。
- ⚡ **节点级并发**：同一父节点最多 **4 个不同位置同时生成**（可配置）。每个
  进行中的点击都会在热点上流式展示阶段（`推断标签…` → `搜索网络…` →
  `生成图像…`）。达到上限后光标变为 ⌛。
- 📖 **百科图鉴风格**：planner 产出 150–220 字的图说和 20–40 处图内文字注释——
  像在读一本细致标注的儿童百科图鉴。
- 🌐 **联网搜索增强**：在 planner 之前先有一个"决策再搜索"的步骤，问大模型当前
  主题是否能从最新 / 权威资料中获益。默认偏向 **要搜**，只有明显抽象 / 超时
  态的主题会跳过。命中后:
    1. 抓取结果并喂给 planner；
    2. 来源同时写入磁盘的 node JSON 和 SQLite `Sources` 表；
    3. 前端在面包屑旁出现 📚 徽标，鼠标移上去显示来源浮层。
- 🎬 **场景切换动效**：钻入 / 钻出 / 渐隐 三套动画，让导航像翻一本会缩放的画
  册，而不是普通的换页。
- 🔗 **预览分享**：任意 canvas → 只读 `?s=<token>` 链接。访客可以浏览、可以通
  过 SSE 看到正在生成的图片实时流式更新，但无法触发新的生成。
- 📺 **全屏投屏**：⛶ 进入浏览器全屏；可一键切换 chrome（面包屑 + 图说 + 提示）
  的显示，便于干净投屏。
- 🔤 **图内文字可选可复制**：图中所有用 ImageGen 画进去的标注（地名、年份、
  数据等）会用 Apple Vision OCR 一遍（`zh-Hans` + `en-US`），把识别出来的
  文本作为透明 HTML 层覆盖在图片上 —— 看起来还是手绘的画风，但用户可以
  直接在图上拖选、Cmd-C 复制任意文字。
- 📱 **移动端适配**：顶栏收拢成图标、单列画廊、热点和待处理气泡按比例缩小。

---

## 🤖 多模态 × 主流大模型

Flipbook Canvas 围绕一条**可插拔的多模态流水线**搭建。端到端串联了三种模态：

| 模态 | 在做什么 | 可接入 |
|---|---|---|
| 📝 **文本 / JSON LLM** | planner、点击位置标签推断、决策搜索判定 | 任意 chat-completion 风格的模型 |
| 🖼️ **图像生成** | 把结构化 prompt 转成 2752×1536 的带文字标注图鉴 | OpenAI、Nano Banana（Gemini）、Seedream/Seeddance，或你自己的 provider |
| 🌐 **联网搜索** | 改写 query → top-N 归一化结果 → 喂给 planner + 📚 来源面板 | 任意搜索后端 |
| 👁️ **OCR（Apple Vision）** | 对每张生成的 PNG 跑 `zh-Hans` + `en-US` 识别，叠出可选文字层 | 本地，无需 API key |

图像层是一条 **provider 链**（`IMAGE_PROVIDER=...,svg`）—— 第一个被启用的
provider 胜出，`svg` 始终作为兜底追加在末尾，即使所有上游模型都挂了 UI 也不
会崩。新增一个模型只是一个文件:

```js
// server/src/generation/providers/<name>.js
export default {
  name: 'my-model',
  enabled(config) { return Boolean(config.MY_API_KEY); },
  async generate({ imagePrompt, outputDir, size, title, hash, onEvent }) {
    // 调你的模型，把 <hash>.png 写进 outputDir，并通过 onEvent 推阶段事件
  },
};
```

开箱即用：

| Provider | 启用条件 | 状态 |
|---|---|---|
| `openai` | 设置了 `OPENAI_API_KEY` | 🔌 接口位 — 在 `providers/openai.js` 实现 |
| `nanobanana` | 设置了 `NANOBANANA_API_KEY` 或 `GEMINI_API_KEY` | 🔌 接口位 |
| `seeddance` | 设置了 `SEEDDANCE_API_KEY` 或 `ARK_API_KEY` | 🔌 接口位 |
| `codebuddy` | `ENABLE_CODEBUDDY=1` | ✅ 参考实现（demo gif 即用此 provider） |
| `svg` | 始终启用 | ✅ 兜底占位 |

> 🎯 **参考实现** 把 `codebuddy` CLI 当作 planner / ImageGen / WebSearch 的子
> 进程驱动来用。子进程生命周期管理（并发上限、单次超时、单次重试、产物体积
> 校验、优雅降级）都收敛在 `server/src/codebuddyClient.js` —— 任何时候你想
> 让产品 shell out 到一个 CLI 形态的模型，这都是个不错的模板。

---

## 🐦 完整示例 —— 从零生成一本"啄木鸟"画册

在顶栏输入 `啄木鸟`，从零观察整条流水线跑完：决策搜索 → 联网检索 →
planner → ImageGen → 点击图中的舌部解剖 / 巢洞剖面 / 草地觅食几个区域，每
个区域都会衍生出自己的图鉴页和自己的参考来源。

---

## 🗂️ 目录结构

```
.
├── prompts/                        # system / planner / click-label / image-prompt / decide-search
├── scripts/sync-prompts.mjs
├── server/
│   └── src/
│       ├── routes/                 # canvas、click、events (SSE)、assets、share
│       ├── generation/
│       │   ├── pipeline.js         # generateRoot + expandFromClick + 节点并发
│       │   ├── decideSearch.js     # 决策是否搜索的关卡
│       │   ├── webSearch.js        # WebSearch 子进程封装 + 结果归一化
│       │   ├── queue.js            # PerCanvasQueue / Semaphore / PerKeySemaphore
│       │   ├── planner.js / clickLabel.js
│       │   ├── image.js            # provider 链编排
│       │   └── providers/          # codebuddy、openai、nanobanana、seeddance、svg
│       ├── db/                     # Sequelize 模型 + hydrateFromDisk
│       ├── store/                  # 文件系统层
│       ├── sse/                    # 事件总线
│       └── codebuddyClient.js      # 参考 CLI 子进程封装
└── web/                            # Vite + React + TS
```

## 💾 存储

- 📁 **文件系统**（大件资源的事实来源）：
  `server/data/canvases/<id>/{data/tree.json, data/nodes/<hash>.json, images/<hash>.{png,svg}, manifest.json}`。
- 🗃️ **SQLite**（`server/data/flipbook.sqlite`，用 Sequelize）：元数据索引——
  Canvases / Nodes / Hotspots / ShareLinks / Sources 五张表，驱动画廊、空间
  去重、分享查询和来源浮层。启动时若发现 SQLite 缺失，会跑 `hydrateFromDisk()`
  从磁盘重建索引。

## 🛠️ 开发

```bash
npm install
npm run dev           # server :8787 + Vite :5173 并行启动
```

打开 http://127.0.0.1:5173。

默认 `ENABLE_CODEBUDDY=0`（stub 模式，飞快、SVG 占位、无大模型）。设置
`ENABLE_CODEBUDDY=1` 即可启用参考的 CLI provider 来跑 planner + ImageGen
+ WebSearch：

```bash
ENABLE_CODEBUDDY=1 npm run dev:server
```

> ⏱️ 使用参考 provider 时，单节点端到端约 **70–95 秒**（planner ~25s +
> ImageGen ~50–60s 含冷启动；开启搜索再 +5–15s）。ImageGen 产出
> **2752×1536 PNG**（约 6 MB）。

### 节点级并发

同一父节点最多 **4 次** 点击展开并行；超出排队。不同父节点、不同 canvas 之
间互不影响。父节点 JSON 的读改写用了一把短锁串行化。可通过
`MAX_PARALLEL_CLICKS_PER_NODE`（默认 4）调整。

## 🔍 联网搜索

planner 之前的关卡（`decideSearch.js` + `prompts/decide-search.md`）会用 LLM
判断当前主题是否能因为最新 / 权威资料而显著提升。默认偏向 **是**——只有抽
象、超时态的主题才跳过。一旦判定要搜：

1. `webSearch.js` 用改写后的 query 跑搜索后端；
2. 结果归一化为 `{title, url, snippet, source}`；
3. Top 结果喂给 planner 提示词；
4. 来源同时持久化到 `nodes/<hash>.json` 和 SQLite `Sources` 表；
5. 前端在面包屑边上出现 📚 徽标，鼠标移上去看来源列表（hover 离开有 220ms
   的宽限期，避免浮层够不到就消失）。

> **没看到参考来源？** 两种最常见的原因：
> 1. **服务进程是旧的** —— `decideSearch.js` / `webSearch.js` 改过，但 dev
>    server 没有重启。`node --watch` 只对存活的进程生效；一旦进程被杀，新
>    生成的节点用的还是旧代码。重新跑 `npm run dev:server` 即可。
> 2. **旧节点不会回填** —— 来源是在节点 *生成时* 写入的。早些 server 跑出
>    来的节点不会被回溯补上来源，必须点出一个新的热点，或者新建一个 canvas
>    才能看到。

## 🔗 分享 / 预览链接

- `POST /api/canvas/:id/share` → `{token, url}`。同一 canvas 复用同一 token。
- `GET /api/share/:token` → `{canvasId, topic, readOnly:true}`。
- 前端：打开 `…?s=<token>` 自动进入 **只读预览** 模式 —— 不显示主题输入框、
  不能在图上点击、右上角有 "👁 Preview" 徽标。SSE 仍然保持连接，所以观众在
  作者还在生成时也能看到图片实时刷出来。

## 📺 全屏 / 投屏

- 顶栏的 `⛶` 进入浏览器全屏；iOS Safari 没有原生全屏 API 时退化成纯 CSS 全屏。
- 全屏时出现的 `👁` / `🚫` 切换面包屑 + 图说 + 操作提示的显示，便于干净投屏。
- 默认会在全屏下隐藏"长按 2 秒"的提示文案，但长按本身仍然可用。

## 🧹 清理本地状态

```bash
npm run clean:data    # rimraf server/data —— 危险操作，所有 canvas 会被抹掉
npm run clean:dist    # rimraf web/dist
npm run clean         # 同时清理两者
```

> ⚠️ `server/data/` 里都是大模型烧出来的昂贵产物，不要随手清。如果里面有重要
> canvas，请先备份 `canvases/` 目录。

## 📦 生产构建

```bash
npm run build         # 构建 web/dist
npm start             # 用 :8787 同时托管 web/dist 和 API
```

## ⚙️ 环境变量配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` | 8787 | 服务端口 |
| `HOST` | 127.0.0.1 | 服务监听地址 |
| `DATA_DIR` | `server/data` | canvas 磁盘目录 |
| `PROMPTS_DIR` | `prompts` | 提示词目录 |
| `DB_PATH` | `<DATA_DIR>/flipbook.sqlite` | SQLite 文件路径 |
| `MAX_PARALLEL_CLICKS_PER_NODE` | 4 | 同一父节点的并发点击上限 |
| `PLANNER_TIMEOUT_MS` | 90000 | 单次 planner 超时 |
| `IMAGE_TIMEOUT_MS` | 180000 | 单次 ImageGen 超时 |
| `WEB_SEARCH_TIMEOUT_MS` | 60000 | 单次 WebSearch 超时 |
| `IMAGE_PROVIDER` | `codebuddy` | provider 链（如 `openai,nanobanana,svg`） |
| `IMAGE_SIZE` | `1920x1080` | 请求的尺寸（provider 可能自己挑） |
| `ENABLE_CODEBUDDY` | 0 | 设为 1 启用参考 CLI provider |
| `ENABLE_WEB_SEARCH` | 跟随 `ENABLE_CODEBUDDY` | 设为 0 强制关闭搜索 |
| `ENABLE_OCR` | 1 | 是否对每张生成的 PNG 跑一次 Apple Vision OCR 以做出可选可复制的文字层；设为 `0` 关闭 |
| `OCR_TIMEOUT_MS` | 25000 | 单次 OCR 超时 |
| `OCR_MIN_CONFIDENCE` | 0.4 | 低于该置信度的 OCR 结果会被丢弃 |

---

[English](./README.md) · **中文**
