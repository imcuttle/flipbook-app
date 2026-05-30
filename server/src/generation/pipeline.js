// End-to-end node generation. Emits SSE events as it progresses.
//
// Two entry points:
//   generateRootNode(canvas) — for canvas creation; just plans + image; no hotspots.
//   expandFromClick(canvas, {parentNode, clickXY}) — produces label, dedups
//     against existing hotspots, then runs full plan+image for the child node,
//     and appends a hotspot to the parent.
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { hashNode } from '../lib/hash.js';
import {
  nodeExists, readNode, registerNode, writeNode, countNodes,
} from '../store/nodeStore.js';
import { paths } from '../store/paths.js';
import { broadcast } from '../sse/hub.js';
import { SseEvents } from '../sse/events.js';
import { callPlanner } from './planner.js';
import { callClickLabel } from './clickLabel.js';
import { generateImage } from './image.js';
import { stubPlannerOutput, stubClickLabel } from './stubPlanner.js';
import { callDecideSearch, stubDecideSearch } from './decideSearch.js';
import { searchWeb } from './searchWeb.js';
import { runOcr } from './ocr.js';
import { describeSeedImage } from './describeSeed.js';
import { touchLastRun, updateCanvasTopic } from '../store/canvasStore.js';
import { PlannerRefusalError } from '../lib/errors.js';
import {
  recordNode, recordHotspot, bumpNodeCount, setCoverIfMissing,
  findNearbyHotspot, recordSources, recordTextSpans,
} from '../db/repo.js';
import { PerKeySemaphore } from './queue.js';
import { log } from '../lib/log.js';

// Up to 4 click expansions per (canvasId, parentHash) run in parallel.
const MAX_PARALLEL_CLICKS_PER_NODE = Number(process.env.MAX_PARALLEL_CLICKS_PER_NODE || 4);
const clickSem = new PerKeySemaphore(MAX_PARALLEL_CLICKS_PER_NODE);

// Per-job generation log helper. Every line gets a `[gen <jobId>]` prefix
// so multiple in-flight jobs (4 parallel clicks per parent + multiple
// canvases) stay readable when interleaved in the server log. Phase tags
// match the SSE event names so a developer can correlate log lines with
// what the frontend's pending bubble was showing at the time.
function genLog(jobId, phase, msg, extra) {
  const prefix = `[gen ${jobId}] ${phase}`;
  if (extra !== undefined) log.info(prefix, msg, extra);
  else log.info(prefix, msg);
}

// Push a user-friendly progress line through SSE so the pending click
// bubble can display "Analysing your image…" / "Searching the web…" /
// etc. instead of just the static phase chip. `messageKey` is an i18n
// identifier the client resolves; `messageEn` is the fallback string
// for clients that don't have a localised entry.
function emitPhaseMessage(canvas, jobId, messageKey, messageEn, extra = {}) {
  try {
    broadcast(canvas, {
      type: SseEvents.PHASE_MESSAGE,
      canvasId: canvas.id,
      jobId,
      messageKey,
      messageEn,
      ...extra,
    });
  } catch { /* SSE write errors are logged in the hub */ }
}

function clickKey(canvasId, parentHash) { return `${canvasId}::${parentHash}`; }

export function clickQueueStatus(canvasId, parentHash) {
  const k = clickKey(canvasId, parentHash);
  return {
    active: clickSem.active(k),
    pending: clickSem.pending(k),
    max: MAX_PARALLEL_CLICKS_PER_NODE,
  };
}

// Per-parent write lock — held only across short read-modify-write of the
// parent node JSON (parent.hotspots[]). Different parents are independent.
const writeLocks = new Map();
function withParentLock(canvasId, parentHash, fn) {
  const k = clickKey(canvasId, parentHash);
  const prev = writeLocks.get(k) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Don't break the chain on a thrown error; let the caller observe it.
  writeLocks.set(k, next.catch(() => {}));
  return next;
}

function plannerCall(args) {
  if (config.enableCodebuddy) return callPlanner(args);
  return Promise.resolve(stubPlannerOutput({
    topic: args.topic,
    currentLabel: args.currentLabel,
    sources: args.sources,
  }));
}

function decideCall(args) {
  if (config.enableCodebuddy) return callDecideSearch(args);
  return Promise.resolve(stubDecideSearch({
    topic: args.topic,
    currentLabel: args.currentLabel,
    depth: args.depth,
  }));
}

async function decideAndSearch({ canvas, jobId, topic, path, currentLabel, depth, intent, webSearchEnabled }) {
  // Per-job opt-out: if the UI toggled web search off, skip the decide gate
  // and the search call entirely. The planner runs without sources.
  if (webSearchEnabled === false) return [];
  let decision;
  try {
    decision = await decideCall({ topic, path, currentLabel, intent, depth });
  } catch (e) {
    log.warn('decide-search failed:', e?.message);
    return [];
  }
  if (!decision.should_search || decision.queries.length === 0) return [];

  broadcast(canvas, {
    type: SseEvents.SEARCH_STARTED, canvasId: canvas.id, jobId,
    queries: decision.queries,
  });
  let sources = [];
  try {
    sources = await searchWeb({ queries: decision.queries, perQueryMax: 5 });
  } catch (e) {
    log.warn('searchWeb failed:', e?.message);
  }
  broadcast(canvas, {
    type: SseEvents.SEARCH_DONE, canvasId: canvas.id, jobId,
    queries: decision.queries, sourceCount: sources.length,
  });
  return sources;
}

function clickLabelCall(args) {
  if (config.enableCodebuddy) return callClickLabel(args);
  return Promise.resolve(stubClickLabel({
    click_xy: args.clickXY,
    existing_labels: args.existingLabels,
    parent_title: args.parentNode.title,
  }));
}

function buildPath(parentNode, hash, title) {
  const base = parentNode?.path?.slice() ?? [];
  return [...base, { hash, title }];
}

function imageUrlFor(canvasId, hash, ext) {
  return `/api/canvas/${canvasId}/images/${hash}.${ext}`;
}

// --------- Core: build a new node (planner + image) ---------
async function buildAndRegisterNode({
  canvas, parentNode, jobId, currentLabel, hashSeed, webSearchEnabled,
  // Optional user-attached source image to seed THIS node's planner +
  // ImageGen pass. When provided, the planner is asked to preserve
  // composition/subject and only restyle, and the image provider is
  // asked to image-to-image edit instead of generate from scratch.
  seedImagePath = null,
  // Snapshot of the inputs that produced this node — replayed by
  // regenerateNode so a re-roll uses the same seed image, user label,
  // and click position on the host parent. Persisted on the node JSON
  // as `gen_inputs`.
  genInputs = null,
  lang = 'zh',
}) {
  const depth = parentNode ? (parentNode.depth ?? 0) + 1 : 0;
  const startedAt = Date.now();
  genLog(jobId, 'start',
    `${parentNode ? `child of ${parentNode.hash}` : 'root'} | topic="${canvas.topic}" | label="${currentLabel || ''}" | depth=${depth}`
    + `${seedImagePath ? ' | seed=' + seedImagePath.split('/').pop() : ''}`
    + ` | webSearch=${webSearchEnabled !== false ? 'on' : 'off'}`,
  );

  // When the user attached a seed image, run a describe-first LLM pass
  // so downstream steps (search queries, planner caption, image prompt)
  // can ground in the actual content of the picture rather than the
  // canvas's filename-derived topic. This is what fixes the symptoms
  // where search queries contained the word "seed" and captions read
  // "this is the source image".
  let seedDescription = null;
  if (seedImagePath && config.enableCodebuddy) {
    const t = Date.now();
    genLog(jobId, 'seed.describe', `analysing ${seedImagePath.split('/').pop()}…`);
    emitPhaseMessage(canvas, jobId, 'phase.seed.describe', 'Analysing your image…');
    try {
      seedDescription = await describeSeedImage({
        seedImagePath,
        userTopic: canvas.topic,
        lang,
      });
      if (seedDescription?.suggested_topic) {
        genLog(jobId, 'seed.describe',
          `→ "${seedDescription.subject}" (${Date.now() - t}ms; queries: ${(seedDescription.search_queries || []).join(' / ') || '∅'})`,
        );
      } else {
        genLog(jobId, 'seed.describe', `→ no structured subject (${Date.now() - t}ms) — falling back to canvas topic`);
      }
    } catch (e) {
      log.warn(`[gen ${jobId}] seed.describe failed: ${e?.message}`);
    }
  }

  // Effective subject — prefer the model's read of what's actually in the
  // image to whatever placeholder the upload route used as the canvas
  // topic. Used for the search step + recorded as the canonical title
  // on the planner output.
  const effectiveSubject = seedDescription?.subject
    || seedDescription?.suggested_topic
    || canvas.topic;

  // Optional web-search step before planner. With a seed image, prefer
  // the model's image-derived queries over the decide-search default
  // (the default would search for the upload's filename / placeholder
  // topic, returning irrelevant results).
  let sources = [];
  if (seedDescription?.search_queries?.length && webSearchEnabled !== false) {
    const tSearch = Date.now();
    genLog(jobId, 'search.seed',
      `running ${seedDescription.search_queries.length} image-derived queries`);
    emitPhaseMessage(canvas, jobId, 'phase.search', 'Searching the web for facts about the subject…');
    broadcast(canvas, {
      type: SseEvents.SEARCH_STARTED, canvasId: canvas.id, jobId,
      queries: seedDescription.search_queries,
    });
    try {
      sources = await searchWeb({
        queries: seedDescription.search_queries,
        perQueryMax: 5,
      });
    } catch (e) {
      log.warn(`[gen ${jobId}] searchWeb (seed) failed: ${e?.message}`);
    }
    genLog(jobId, 'search.seed',
      `→ ${sources.length} sources (${Date.now() - tSearch}ms)`);
    broadcast(canvas, {
      type: SseEvents.SEARCH_DONE, canvasId: canvas.id, jobId,
      queries: seedDescription.search_queries,
      sourceCount: sources.length,
    });
  } else {
    const tSearch = Date.now();
    if (webSearchEnabled !== false) {
      emitPhaseMessage(canvas, jobId, 'phase.search', 'Searching the web for facts about the subject…');
    }
    sources = await decideAndSearch({
      canvas, jobId,
      topic: effectiveSubject,
      path: parentNode?.path ?? [],
      currentLabel: currentLabel ?? '',
      depth,
      intent: parentNode ? 'drilldown' : 'root',
      webSearchEnabled,
    });
    if (webSearchEnabled !== false) {
      genLog(jobId, 'search.decide',
        `→ ${sources.length} sources (${Date.now() - tSearch}ms)`);
    } else {
      genLog(jobId, 'search.decide', 'skipped (toggle off)');
    }
  }

  const tPlanner = Date.now();
  genLog(jobId, 'planner', `topic="${effectiveSubject}" sources=${sources.length}`);
  emitPhaseMessage(canvas, jobId, 'phase.planner', 'Drafting title, caption and scene…');
  let plannerJson;
  try {
    plannerJson = await plannerCall({
      topic: effectiveSubject,
      path: parentNode?.path ?? [],
      currentLabel: currentLabel ?? '',
      depth,
      maxDepth: 99,
      sources,
      seedImagePath,
      seedDescription,
      lang,
    });
    genLog(jobId, 'planner',
      `→ "${plannerJson.title}" (caption ${plannerJson.caption.length}c, image_prompt ${plannerJson.image_prompt.length}c, ${Date.now() - tPlanner}ms)`);
  } catch (e) {
    // Refusals (model returned prose / content-policy decline) come
    // back as PlannerRefusalError with the prose carried as the message.
    // Surface it as a non-recoverable planner-phase error so the UI
    // toast is the model's own explanation, not a stack-trace summary.
    const isRefusal = e instanceof PlannerRefusalError;
    broadcast(canvas, {
      type: SseEvents.ERROR, canvasId: canvas.id, jobId,
      phase: 'plan',
      message: isRefusal ? e.message : String(e?.message || e),
      code: isRefusal ? 'planner_refusal' : 'planner_error',
      recoverable: false,
    });
    if (isRefusal) {
      log.warn(`[gen ${jobId}] planner refusal: ${e.message.slice(0, 200)}`);
    } else {
      log.error(`[gen ${jobId}] planner error:`, e?.stack || e);
    }
    throw e;
  }

  const parentHash = parentNode?.hash ?? '';
  const hash = hashNode(parentHash, hashSeed, plannerJson.image_prompt);

  // Cache check
  if (await nodeExists(canvas.id, hash)) {
    genLog(jobId, 'cache-hit', `${hash} — same hashSeed → existing node`);
    const cached = await readNode(canvas.id, hash);
    broadcast(canvas, { type: SseEvents.NODE_READY, canvasId: canvas.id, jobId, hash, node: cached });
    return { node: cached, cacheHit: true };
  }

  const path = buildPath(parentNode, hash, plannerJson.title);
  const skeleton = {
    hash,
    depth,
    parent: parentNode?.hash ?? null,
    title: plannerJson.title,
    caption: plannerJson.caption,
    image_prompt: plannerJson.image_prompt,
    hotspots: [],
    sources: sources.map((s) => ({
      title: s.title, url: s.url, snippet: s.snippet, source: s.source,
    })),
    web_search_used: webSearchEnabled !== false,
    // Persist the upload path so future debugging / re-renders can find it.
    ...(seedImagePath ? { seed_image: seedImagePath } : {}),
    // Snapshot of the click context that produced this node, so a
    // Regenerate request can replay the exact same parent + click point
    // + user-typed label + seed-image triple. Captured here for child
    // nodes; root nodes have parent_hash=null + no click_xy.
    ...(genInputs ? { gen_inputs: genInputs } : {}),
    path,
    style_tag: 'isometric-illustration',
  };
  broadcast(canvas, { type: SseEvents.PLANNER_DONE, canvasId: canvas.id, jobId, hash, node: skeleton });

  const tImage = Date.now();
  genLog(jobId, 'image', `${seedImagePath ? 'image-edit' : 'text-to-image'} hash=${hash}`);
  broadcast(canvas, { type: SseEvents.IMAGE_STARTED, canvasId: canvas.id, jobId, hash });
  emitPhaseMessage(canvas, jobId,
    seedImagePath ? 'phase.image.edit' : 'phase.image.gen',
    seedImagePath ? 'Generating annotated image from your upload…' : 'Generating illustration…');
  let imageOutcome;
  try {
    imageOutcome = await generateImage({
      canvasId: canvas.id, hash,
      title: plannerJson.title, imagePrompt: plannerJson.image_prompt,
      seedImagePath,
      seedDescription,
      lang,
      // Forward image-orchestrator phase events (start / repair / retry /
      // done / fallback) into SSE phase_message events so the user can
      // see the LLM-driven prompt-repair retry happen in real time.
      onPhase: ({ phase, message }) => {
        const map = {
          'image.start':    { key: 'phase.image.gen',     fb: message },
          'image.repair':   { key: 'phase.image.repair',  fb: 'Image model declined — refining prompt…' },
          'image.retry':    { key: 'phase.image.retry',   fb: 'Retrying with refined prompt…' },
          'image.done':     { key: 'phase.image.done',    fb: 'Image ready' },
          'image.fallback': { key: 'phase.image.fallback', fb: 'Image generation failed — using placeholder' },
        };
        const m = map[phase] ?? { key: 'phase.image.gen', fb: message };
        emitPhaseMessage(canvas, jobId, m.key, m.fb);
      },
    });
    genLog(jobId, 'image',
      `→ ${imageOutcome.providerName}.${imageOutcome.ext}${imageOutcome.fallback ? ' (fallback)' : ''}${imageOutcome.repaired ? ' [repaired]' : ''} (${Date.now() - tImage}ms)`);
  } catch (e) {
    broadcast(canvas, {
      type: SseEvents.ERROR, canvasId: canvas.id, jobId,
      phase: 'image', message: String(e?.message || e), recoverable: true,
    });
    throw e;
  }
  if (imageOutcome.fallback && imageOutcome.reason) {
    broadcast(canvas, {
      type: SseEvents.ERROR, canvasId: canvas.id, jobId,
      phase: 'image', message: imageOutcome.reason, recoverable: true,
    });
  }

  const imageRel = `images/${hash}.${imageOutcome.ext}`;
  const imageUrl = imageUrlFor(canvas.id, hash, imageOutcome.ext);
  broadcast(canvas, {
    type: SseEvents.IMAGE_READY, canvasId: canvas.id, jobId, hash,
    imageUrl, fallback: imageOutcome.fallback === true,
  });

  // OCR pass — only for real PNGs (skip the SVG placeholder fallback). Failure
  // is non-fatal: we just don't get a selectable text overlay for this node.
  let textLayer = [];
  let imageW;
  let imageH;
  if (imageOutcome.ext === 'png' && !imageOutcome.fallback) {
    const ocr = await runOcr({ imagePath: paths.imagePath(canvas.id, hash, 'png') });
    if (ocr.ok) {
      textLayer = ocr.spans;
      imageW = ocr.imageW;
      imageH = ocr.imageH;
    } else if (ocr.reason && ocr.reason !== 'ocr disabled') {
      log.warn(`[ocr] ${canvas.id}/${hash}: ${ocr.reason}`);
    }
    broadcast(canvas, {
      type: SseEvents.OCR_DONE, canvasId: canvas.id, jobId, hash,
      spanCount: textLayer.length,
    });
  }

  const node = {
    ...skeleton,
    image: imageRel,
    generated_at: new Date().toISOString(),
    text_layer: textLayer,
    ...(imageW && imageH ? { image_w: imageW, image_h: imageH } : {}),
  };
  await registerNode(canvas.id, node);
  await touchLastRun(canvas.id);

  // Keep the canvas's gallery-displayed topic in sync with the planner's
  // root-node title. Two cases need this:
  //   1. Image-only uploads — canvas was created with sentinel '__pending__'.
  //   2. Image + user topic — the planner's inferred subject is usually
  //      more specific than the user's loose topic, and a mismatch between
  //      the gallery card title and the canvas's actual node title is
  //      confusing. Sync only on the FIRST root build (when canvas.topic
  //      is still '__pending__' OR when this is a brand-new canvas with
  //      a seed image) — subsequent regenerates leave the topic alone so
  //      the user's curated rename isn't blown away.
  if (!parentNode && plannerJson.title) {
    const isPending = canvas.topic === '__pending__';
    const isFirstRootForSeed = !!seedImagePath && !canvas.__rootTitled;
    if (isPending || isFirstRootForSeed) {
      await updateCanvasTopic(canvas.id, plannerJson.title);
      canvas.__rootTitled = true;
    }
  }

  try {
    await recordNode({
      canvasId: canvas.id, hash,
      parentHash: parentNode?.hash ?? null,
      depth, title: node.title, imageRel, createdAt: new Date(node.generated_at),
    });
    await bumpNodeCount(canvas.id);
    if (!parentNode) await setCoverIfMissing(canvas.id, hash, imageUrl);
    if (sources.length) await recordSources(canvas.id, hash, sources);
    if (textLayer.length) await recordTextSpans(canvas.id, hash, textLayer);
  } catch (e) { log.warn('db recordNode:', e?.message); }

  broadcast(canvas, { type: SseEvents.NODE_READY, canvasId: canvas.id, jobId, hash, node });
  const total = await countNodes(canvas.id);
  broadcast(canvas, { type: SseEvents.TREE_UPDATED, canvasId: canvas.id, jobId, treeNodeCount: total });
  genLog(jobId, 'done',
    `${hash} "${node.title}" — ${Date.now() - startedAt}ms total | tree=${total} nodes`);
  return { node, cacheHit: false };
}

// --------- Public: root node ---------
export async function generateRootNode(canvas, args = {}) {
  const jobId = args.jobId || nanoid(8);
  broadcast(canvas, {
    type: SseEvents.PLANNING_STARTED, canvasId: canvas.id, jobId,
    parentHash: null, hotspotIndex: null, label: canvas.topic,
  });
  const { node, cacheHit } = await buildAndRegisterNode({
    canvas, parentNode: null, jobId,
    currentLabel: '', hashSeed: canvas.topic,
    webSearchEnabled: args.webSearchEnabled,
    seedImagePath: args.seedImagePath ?? null,
    lang: args.lang ?? 'zh',
  });
  broadcast(canvas, {
    type: SseEvents.DONE, canvasId: canvas.id, jobId, hash: node.hash, cacheHit,
  });
  return node;
}

// --------- Public: click → label → child node + parent hotspot append ---------
export async function expandFromClick(canvas, args = {}) {
  const jobId = args.jobId || nanoid(8);
  const { parentNode, clickXY, webSearchEnabled, seedImagePath, userLabel, lang = 'zh' } = args;
  if (!parentNode || !Array.isArray(clickXY)) throw new Error('parentNode and clickXY required');

  genLog(jobId, 'click',
    `parent=${parentNode.hash} xy=[${clickXY[0].toFixed(3)},${clickXY[1].toFixed(3)}]`
    + `${userLabel ? ` userLabel="${userLabel}"` : ''}`
    + `${seedImagePath ? ' seed=' + seedImagePath.split('/').pop() : ''}`,
  );

  // Snapshot the original generation inputs so a future Regenerate can
  // replay the exact same context (seed image path, user-typed label,
  // click position on the host parent). Stored on the child node JSON
  // as `gen_inputs`.
  const genInputs = {
    parent_hash: parentNode.hash,
    click_xy: [Number(clickXY[0]) || 0, Number(clickXY[1]) || 0],
    user_label: userLabel ?? null,
    seed_image: seedImagePath ?? null,
  };

  // Spatial dedup: if there's already a hotspot near this click, jump to its child.
  const SPATIAL_THRESHOLD = 0.06;
  const near = await findNearbyHotspot({
    canvasId: canvas.id, parentHash: parentNode.hash,
    x: clickXY[0], y: clickXY[1], threshold: SPATIAL_THRESHOLD,
  });
  if (near?.childHash) {
    genLog(jobId, 'dedup.spatial', `→ jumping to existing ${near.childHash}`);
    const cached = await readNode(canvas.id, near.childHash);
    broadcast(canvas, {
      type: SseEvents.NODE_READY, canvasId: canvas.id, jobId,
      hash: near.childHash, node: cached,
    });
    broadcast(canvas, {
      type: SseEvents.DONE, canvasId: canvas.id, jobId,
      hash: near.childHash, cacheHit: true,
    });
    return cached;
  }

  // 1) Label inference (skipped when the user supplied an explicit label
  //    — they've already told us what they want).
  broadcast(canvas, {
    type: SseEvents.PLANNING_STARTED, canvasId: canvas.id, jobId,
    parentHash: parentNode.hash, hotspotIndex: null, label: null,
    clickXY,
  });

  let labelOut;
  if (userLabel && userLabel.trim()) {
    // User-supplied label — synthesize the hotspot record without an LLM call.
    const trimmed = userLabel.trim().slice(0, 80);
    genLog(jobId, 'label.user', `"${trimmed}" — skipping LLM inference`);
    labelOut = {
      label: trimmed,
      anchor_xy: [clickXY[0] + 0.08, clickXY[1] + 0.06],
      leader_xy: clickXY,
      next_prompt: trimmed,
    };
  } else {
    const tLabel = Date.now();
    genLog(jobId, 'label.llm', 'inferring from click position…');
    labelOut = await clickLabelCall({
      parentNode, clickXY,
      existingLabels: parentNode.hotspots ?? [],
      canvasId: canvas.id,
      jobId,
      lang,
    });
    if (labelOut.rejected) {
      genLog(jobId, 'label.llm', `→ REJECTED (${Date.now() - tLabel}ms): ${labelOut.reason}`);
    } else {
      genLog(jobId, 'label.llm', `→ "${labelOut.label}" (${Date.now() - tLabel}ms)`);
    }
  }

  // Low-confidence rejection: the LLM didn't see anything drillable under
  // the click. Tell the frontend to clear the pending bubble + toast the
  // user, then exit without appending a hotspot or generating a child.
  if (labelOut.rejected) {
    broadcast(canvas, {
      type: SseEvents.CLICK_REJECTED, canvasId: canvas.id, jobId,
      parentHash: parentNode.hash, clickXY,
      reason: labelOut.reason,
    });
    broadcast(canvas, {
      type: SseEvents.DONE, canvasId: canvas.id, jobId,
      hash: parentNode.hash, cacheHit: false,
    });
    return null;
  }

  // Semantic dedup: same label string already exists?
  const existing = (parentNode.hotspots ?? []).find(
    (h) => h.label?.trim().toLowerCase() === labelOut.label?.trim().toLowerCase(),
  );
  if (existing?.next_hash) {
    genLog(jobId, 'dedup.semantic',
      `→ "${labelOut.label}" already exists → ${existing.next_hash}`);
    const cached = await readNode(canvas.id, existing.next_hash);
    broadcast(canvas, {
      type: SseEvents.NODE_READY, canvasId: canvas.id, jobId,
      hash: existing.next_hash, node: cached,
    });
    broadcast(canvas, {
      type: SseEvents.DONE, canvasId: canvas.id, jobId,
      hash: existing.next_hash, cacheHit: true,
    });
    return cached;
  }

  // 2) Append a pending hotspot to parent (so the UI can render the card immediately
  //    while the child is being generated). Per-parent lock prevents concurrent
  //    clicks from clobbering each other's hotspots[] mutations.
  const newHotspot = {
    label: labelOut.label,
    anchor_xy: labelOut.anchor_xy,
    leader_xy: labelOut.leader_xy,
    next_prompt: labelOut.next_prompt,
    next_hash: null, // filled after child is generated
  };
  let myHotspotIndex;
  const parentAfterAppend = await withParentLock(canvas.id, parentNode.hash, async () => {
    const fresh = await readNode(canvas.id, parentNode.hash);
    fresh.hotspots = [...(fresh.hotspots ?? []), newHotspot];
    myHotspotIndex = fresh.hotspots.length - 1;
    await writeNode(canvas.id, fresh);
    return fresh;
  });
  broadcast(canvas, {
    type: SseEvents.NODE_READY, canvasId: canvas.id, jobId,
    hash: parentAfterAppend.hash, node: parentAfterAppend,
  });

  // 3) Build child node
  const { node: child, cacheHit } = await buildAndRegisterNode({
    canvas, parentNode: parentAfterAppend, jobId,
    currentLabel: labelOut.label,
    hashSeed: labelOut.label,
    webSearchEnabled,
    seedImagePath,
    genInputs,
    lang,
  });

  // 4) Link child on parent's hotspot — re-read inside the lock to avoid
  //    overwriting a sibling click's append between step 2 and now.
  const parentAfterLink = await withParentLock(canvas.id, parentNode.hash, async () => {
    const fresh = await readNode(canvas.id, parentNode.hash);
    if (fresh.hotspots[myHotspotIndex]) {
      fresh.hotspots[myHotspotIndex].next_hash = child.hash;
      await writeNode(canvas.id, fresh);
    }
    return fresh;
  });
  broadcast(canvas, {
    type: SseEvents.NODE_READY, canvasId: canvas.id, jobId,
    hash: parentAfterLink.hash, node: parentAfterLink,
  });

  // 5) Index hotspot in DB (for spatial dedup on future clicks)
  try {
    await recordHotspot({
      canvasId: canvas.id,
      parentHash: parentAfterLink.hash,
      childHash: child.hash,
      label: newHotspot.label,
      anchorXY: newHotspot.anchor_xy,
      leaderXY: newHotspot.leader_xy,
    });
  } catch (e) { log.warn('db recordHotspot:', e?.message); }

  broadcast(canvas, {
    type: SseEvents.DONE, canvasId: canvas.id, jobId,
    hash: child.hash, cacheHit,
  });
  return child;
}

// --------- Queueing helpers ---------
export function enqueueRootGeneration(canvas, opts = {}) {
  const jobId = nanoid(8);
  const webSearchEnabled = opts.webSearchEnabled !== false; // default on
  const seedImagePath = opts.seedImagePath ?? null;
  const lang = opts.lang ?? 'zh';
  genLog(jobId, 'enqueue.root',
    `canvas=${canvas.id} topic="${canvas.topic}"${seedImagePath ? ' (seeded)' : ''}`);
  canvas.queue.enqueue(() => generateRootNode(canvas, { jobId, webSearchEnabled, seedImagePath, lang }).catch((e) => {
    if (e instanceof PlannerRefusalError) {
      log.warn(`[gen ${jobId}] generateRootNode aborted: model refused (${e.message.slice(0, 120)})`);
    } else {
      log.error(`[gen ${jobId}] generateRootNode failed:`, e?.stack || e);
    }
  }));
  return jobId;
}

// Click expansions: capped at MAX_PARALLEL_CLICKS_PER_NODE per (canvas, parent).
// Different parents and different canvases run in parallel. Excess clicks are
// queued in arrival order until a slot frees up.
export function enqueueClickExpansion(canvas, { parentNode, clickXY, webSearchEnabled, seedImagePath, userLabel, lang = 'zh' }) {
  const jobId = nanoid(8);
  const key = clickKey(canvas.id, parentNode.hash);
  const enabled = webSearchEnabled !== false; // default on
  genLog(jobId, 'enqueue.click',
    `canvas=${canvas.id} parent=${parentNode.hash}`
    + ` xy=[${Number(clickXY[0]).toFixed(3)},${Number(clickXY[1]).toFixed(3)}]`
    + `${userLabel ? ' label="' + userLabel + '"' : ''}`
    + `${seedImagePath ? ' (seeded)' : ''}`,
  );
  // Fire-and-forget; progress is reported via SSE.
  clickSem.run(key, () => expandFromClick(canvas, {
    parentNode, clickXY, jobId,
    webSearchEnabled: enabled,
    seedImagePath: seedImagePath ?? null,
    userLabel: userLabel ?? null,
    lang,
  }))
    .catch((e) => {
      if (e instanceof PlannerRefusalError) {
        log.warn(`[gen ${jobId}] expandFromClick aborted: model refused (${e.message.slice(0, 120)})`);
      } else {
        log.error(`[gen ${jobId}] expandFromClick failed:`, e?.stack || e);
      }
    });
  // Surface queue stats so the route can echo them back to the client.
  return {
    jobId,
    queue: clickQueueStatus(canvas.id, parentNode.hash),
  };
}
