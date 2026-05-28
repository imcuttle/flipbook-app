# Flipbook Canvas — CS App

[English](./README.md) · **中文**

> 在生成的图片上任意位置长按。后端会推断你点的是什么、必要时联网搜索资料、
> 生成一张子图并把它链回来。一本可以"点出来"的可探索画册 —— 一次一个点击。

![Flipbook Canvas 演示](./docs/assets/demo.gif)

`flipbook-canvas` skill 的常驻 Web 产品版：Express + SSE 后端、Vite + React
前端、可插拔的图像生成 provider（默认 codebuddy CLI；OpenAI / Nano Banana /
Seedream 留好接口位等 key），带网络搜索增强的 planner、按节点并发、只读分享
链接、全屏投屏，以及完整的移动端响应式布局。

> **范围提醒**：仅本机使用，未内置鉴权，`?n=<canvasId>` / `?s=<shareToken>`
> 是唯一的访问凭据。请勿暴露到本机以外的环境。

---

## 基于 CodeBuddy 构建 —— 一个 CodeBuddy good case

本项目是一个把 **[CodeBuddy](https://cnb.cool/codebuddy/codebuddy-code) CLI 作为运行时依赖** 来用的范例，而不仅仅把它当编码助手。整条知识生成流水线都靠把 `codebuddy` 作为子进程拉起、解析它的 stream-json 输出来驱动：

- **`ENABLE_CODEBUDDY=1` 时 CodeBuddy 是硬性运行时依赖** —— 服务端会解析 `CODEBUDDY_BIN`（默认值：`codebuddy`），每生成一个节点就 shell out 一次。`$PATH` 上没有 codebuddy，就没法真正生成。（`ENABLE_CODEBUDDY=0` 的 stub 模式仅用于本地 UI 调试和 CI。）
- **流水线里接入了 CodeBuddy 的三种能力：**
  - `codebuddy --print --output-format json` 用于 **planner**（`server/src/generation/planner.js`）和 **决策搜索**（`generation/decideSearch.js`）—— 一次性的文本 / JSON 调用，产出图说、点击位置标签、以及"搜不搜"的判定。
  - `codebuddy --print --output-format stream-json --input-format stream-json` 用于 **ImageGen**（`generation/providers/codebuddy.js`）—— 让模型调用它内置的 `ImageGen` 工具，stdout 上每出现一个阶段事件就通过 SSE 推到前端。
  - `codebuddy WebSearch` 用于 **联网增强 planner**（`generation/webSearch.js`）—— 结果归一化后喂给 planner 提示词，并以 📚 来源的形式持久化在节点旁边。
- **子进程的生命周期管理收敛在 `server/src/codebuddyClient.js`：** 所有 spawn 都加 `-y`（`--dangerously-skip-permissions`）；用 `Semaphore` 控制全局并发上限（`MAX_PARALLEL_CODEBUDDY`，默认 2）；每个调用都有自己的超时（`PLANNER_TIMEOUT_MS` / `IMAGE_TIMEOUT_MS` / `WEB_SEARCH_TIMEOUT_MS`）；失败再重试 1 次后才抛出类型化错误。ImageGen 额外用 `fs.stat` 校验产物 ≥ 512 字节，防止"静默成功但没文件"的坑。
- **CodeBuddy 不可用时的降级链：** `IMAGE_PROVIDER` 是逗号分隔的 provider 链（例如 `codebuddy,openai,svg`）；`svg` 始终作为最后兜底，即使上游全失败也不会让 UI 崩。

如果你在评估把 CodeBuddy 作为交互产品的后端依赖，这个 app 想给你一份参考：**怎么把它拉起来、怎么从它那里流式拿结果、怎么限流和限时、以及它没法用时怎么优雅降级。**

---

## 亮点

- **点击式探索**：在节点图上任意位置 **长按 2 秒**。后端推断你点击位置的语义
  标签、判断是否需要联网搜索、最终生成一个子节点。空间 + 语义双重去重，再次
  点击同一区域会直接跳进去。
- **节点级并发**：同一父节点最多 **4 个不同位置同时生成**（可配置）。每个进
  行中的点击都会在热点上流式展示阶段（`推断标签…` → `搜索网络…` →
  `生成图像…`）。达到上限后光标变为 ⌛。
- **百科图鉴风格**：planner 产出 150–220 字的图说和 20–40 处图内文字注释——
  像在读一本细致标注的儿童百科图鉴。
- **联网搜索增强**：在 planner 之前先有一个"决策再搜索"的步骤，问大模型当前
  主题是否能从最新 / 权威资料中获益。默认偏向 **要搜**，只有明显抽象 / 超时
  态的主题会跳过。命中后：
    1. 抓取结果并喂给 planner；
    2. 来源同时写入磁盘的 node JSON 和 SQLite `Sources` 表；
    3. 前端在面包屑旁出现 📚 徽标，鼠标移上去显示来源浮层。
- **场景切换动效**：钻入 / 钻出 / 渐隐 三套动画，让导航像翻一本会缩放的画
  册，而不是普通的换页。
- **预览分享**：任意 canvas → 只读 `?s=<token>` 链接。访客可以浏览、可以通
  过 SSE 看到正在生成的图片实时流式更新，但无法触发新的生成。
- **全屏投屏**：⛶ 进入浏览器全屏；可一键切换 chrome（面包屑 + 图说 + 提示）
  的显示，便于干净投屏。
- **移动端适配**：顶栏收拢成图标、单列画廊、热点和待处理气泡按比例缩小。

![画廊与画布](./docs/assets/screenshot.png)

## 完整示例 —— 从零生成一本"啄木鸟"画册

在顶栏输入 `啄木鸟`，从零观察整条流水线跑完：决策搜索 → 联网检索 →
planner → ImageGen → 点击图中的舌部解剖 / 巢洞剖面 / 草地觅食几个区域，每
个区域都会衍生出自己的图鉴页和自己的参考来源。

![从零生成啄木鸟画册](./docs/assets/woodpecker.gif)

---

## 目录结构

```
app/
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
│       ├── store/                  # 文件系统层（与 skill 格式对齐）
│       ├── sse/                    # 事件总线
│       └── codebuddyClient.js      # codebuddy CLI 子进程封装
└── web/                            # Vite + React + TS
```

## 存储

- **文件系统**（大件资源的事实来源）：
  `server/data/canvases/<id>/{data/tree.json, data/nodes/<hash>.json, images/<hash>.{png,svg}, manifest.json}`。
  字节级兼容静态站 skill 的 `init.mjs` 产物。
- **SQLite**（`server/data/flipbook.sqlite`，用 Sequelize）：元数据索引——
  Canvases / Nodes / Hotspots / ShareLinks / Sources 五张表，驱动画廊、空间
  去重、分享查询和来源浮层。启动时若发现 SQLite 缺失，会跑 `hydrateFromDisk()`
  从磁盘重建索引。

## 开发

```bash
cd app
npm install
npm run dev           # server :8787 + Vite :5173 并行启动
```

打开 http://127.0.0.1:5173。

默认 `ENABLE_CODEBUDDY=0`（stub 模式，飞快、SVG 占位、无大模型）。设置
`ENABLE_CODEBUDDY=1` 即可启用真正的 codebuddy CLI 来跑 planner + ImageGen
+ WebSearch：

```bash
ENABLE_CODEBUDDY=1 npm run dev:server
```

### 真实 codebuddy 时长

- 单节点端到端约 **70–95 秒**（planner ~25s + ImageGen ~50–60s 含冷启动；
  开启搜索再 +5–15s）。
- ImageGen 产出 **2752×1536 PNG**（约 6 MB）；模型自己挑尺寸，与
  `IMAGE_SIZE` 无关。
- 所有 codebuddy 子进程都加 `-y`（`--dangerously-skip-permissions`）。

### 节点级并发

同一父节点最多 **4 次** 点击展开并行；超出排队。不同父节点、不同 canvas 之
间互不影响。父节点 JSON 的读改写用了一把短锁串行化。可通过
`MAX_PARALLEL_CLICKS_PER_NODE`（默认 4）调整。

## 图像 provider

通过 `IMAGE_PROVIDER` 环境变量配置（逗号分隔的链；第一个被启用的 provider 胜
出，`svg` 总是兜底追加在末尾）：

| Provider | 启用条件 |
|---|---|
| `codebuddy` | `ENABLE_CODEBUDDY=1`（默认） |
| `openai` | 设置了 `OPENAI_API_KEY`；**接口位 — 在 providers/openai.js 实现** |
| `nanobanana` | 设置了 `NANOBANANA_API_KEY` 或 `GEMINI_API_KEY`；**接口位** |
| `seeddance` | 设置了 `SEEDDANCE_API_KEY` 或 `ARK_API_KEY`；**接口位** |
| `svg` | 始终启用（兜底占位） |

新增 provider：在 `server/src/generation/providers/<name>.js` 中导出
`{name, enabled(config), generate({imagePrompt, outputDir, size, title, hash, onEvent})}`，
然后到 `providers/index.js` 里注册即可。把产物文件改名为 `<hash>.png` 这件事
由编排器统一负责。

## 联网搜索

planner 之前的关卡（`decideSearch.js` + `prompts/decide-search.md`）会用 LLM
判断当前主题是否能因为最新 / 权威资料而显著提升。默认偏向 **是**——只有抽
象、超时态的主题才跳过。一旦判定要搜：

1. `webSearch.js` 用改写后的 query 跑 `codebuddy WebSearch`；
2. 结果归一化为 `{title, url, snippet, source}`；
3. Top 结果喂给 planner 提示词；
4. 来源同时持久化到 `nodes/<hash>.json` 和 SQLite `Sources` 表；
5. 前端在面包屑边上出现 📚 徽标，鼠标移上去看来源列表（hover 离开有 220ms
   的宽限期，避免浮层够不到就消失）。

> **没看到参考来源？** 两种最常见的原因：
> 1. **服务进程是旧的** —— `decideSearch.js` / `searchWeb.js` 改过，但 dev
>    server 没有重启。`node --watch` 只对存活的进程生效；一旦进程被杀，新
>    生成的节点用的还是旧代码。重新跑 `npm run dev:server` 即可。
> 2. **旧节点不会回填** —— 来源是在节点 *生成时* 写入的。早些 server 跑出
>    来的节点不会被回溯补上来源，必须点出一个新的热点，或者新建一个 canvas
>    才能看到。

## 分享 / 预览链接

- `POST /api/canvas/:id/share` → `{token, url}`。同一 canvas 复用同一 token。
- `GET /api/share/:token` → `{canvasId, topic, readOnly:true}`。
- 前端：打开 `…?s=<token>` 自动进入 **只读预览** 模式 —— 不显示主题输入框、
  不能在图上点击、右上角有 "👁 Preview" 徽标。SSE 仍然保持连接，所以观众在
  作者还在生成时也能看到图片实时刷出来。

## 全屏 / 投屏

- 顶栏的 `⛶` 进入浏览器全屏；iOS Safari 没有原生全屏 API 时退化成纯 CSS 全屏。
- 全屏时出现的 `👁` / `🚫` 切换面包屑 + 图说 + 操作提示的显示，便于干净投屏。
- 默认会在全屏下隐藏"长按 2 秒"的提示文案，但长按本身仍然可用。

## 清理本地状态

```bash
npm run clean:data    # rimraf server/data —— 危险操作，所有 canvas 会被抹掉
npm run clean:dist    # rimraf web/dist
npm run clean         # 同时清理两者
```

> ⚠️ `server/data/` 里都是大模型烧出来的昂贵产物，不要随手清。如果里面有重要
> canvas，请先备份 `canvases/` 目录。

## 生产构建

```bash
npm run build         # 构建 web/dist
npm start             # 用 :8787 同时托管 web/dist 和 API
```

## 环境变量配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` | 8787 | 服务端口 |
| `HOST` | 127.0.0.1 | 服务监听地址 |
| `DATA_DIR` | `server/data` | canvas 磁盘目录 |
| `PROMPTS_DIR` | `app/prompts` | 提示词目录 |
| `DB_PATH` | `<DATA_DIR>/flipbook.sqlite` | SQLite 文件路径 |
| `CODEBUDDY_BIN` | `codebuddy` | codebuddy 可执行文件路径 |
| `MAX_PARALLEL_CODEBUDDY` | 2 | 全局子进程上限 |
| `MAX_PARALLEL_CLICKS_PER_NODE` | 4 | 同一父节点的并发点击上限 |
| `PLANNER_TIMEOUT_MS` | 90000 | 单次 planner 超时 |
| `IMAGE_TIMEOUT_MS` | 180000 | 单次 ImageGen 超时 |
| `WEB_SEARCH_TIMEOUT_MS` | 60000 | 单次 WebSearch 超时 |
| `IMAGE_PROVIDER` | `codebuddy` | provider 链（如 `openai,codebuddy,svg`） |
| `IMAGE_SIZE` | `1920x1080` | 请求的尺寸（provider 可能自己挑） |
| `ENABLE_CODEBUDDY` | 0 | 设为 1 启用真实生成 |
| `ENABLE_WEB_SEARCH` | 跟随 `ENABLE_CODEBUDDY` | 设为 0 强制关闭搜索 |

## 磁盘格式兼容性

`server/data/canvases/<canvasId>/` 与静态站 skill 的 `init.mjs` 产物字节级兼
容，做完的 canvas 可以丢给 `skill/scripts/assemble.mjs` 直接导出成静态站。
反过来把 skill 生成的文件夹丢进 `server/data/canvases/` 重启服务，启动时的
`hydrateFromDisk()` 会把它认出来。

---

[English](./README.md) · **中文**
