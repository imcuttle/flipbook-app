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
import { touchLastRun } from '../store/canvasStore.js';
import {
  recordNode, recordHotspot, bumpNodeCount, setCoverIfMissing,
  findNearbyHotspot, recordSources, recordTextSpans,
} from '../db/repo.js';
import { PerKeySemaphore } from './queue.js';
import { log } from '../lib/log.js';

// Up to 4 click expansions per (canvasId, parentHash) run in parallel.
const MAX_PARALLEL_CLICKS_PER_NODE = Number(process.env.MAX_PARALLEL_CLICKS_PER_NODE || 4);
const clickSem = new PerKeySemaphore(MAX_PARALLEL_CLICKS_PER_NODE);

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
}) {
  const depth = parentNode ? (parentNode.depth ?? 0) + 1 : 0;

  // Optional web-search step before planner.
  const sources = await decideAndSearch({
    canvas, jobId,
    topic: canvas.topic,
    path: parentNode?.path ?? [],
    currentLabel: currentLabel ?? '',
    depth,
    intent: parentNode ? 'drilldown' : 'root',
    webSearchEnabled,
  });

  let plannerJson;
  try {
    plannerJson = await plannerCall({
      topic: canvas.topic,
      path: parentNode?.path ?? [],
      currentLabel: currentLabel ?? '',
      depth,
      maxDepth: 99,
      sources,
    });
  } catch (e) {
    broadcast(canvas, {
      type: SseEvents.ERROR, canvasId: canvas.id, jobId,
      phase: 'plan', message: String(e?.message || e), recoverable: false,
    });
    throw e;
  }

  const parentHash = parentNode?.hash ?? '';
  const hash = hashNode(parentHash, hashSeed, plannerJson.image_prompt);

  // Cache check
  if (await nodeExists(canvas.id, hash)) {
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
    path,
    style_tag: 'isometric-illustration',
  };
  broadcast(canvas, { type: SseEvents.PLANNER_DONE, canvasId: canvas.id, jobId, hash, node: skeleton });

  broadcast(canvas, { type: SseEvents.IMAGE_STARTED, canvasId: canvas.id, jobId, hash });
  let imageOutcome;
  try {
    imageOutcome = await generateImage({
      canvasId: canvas.id, hash,
      title: plannerJson.title, imagePrompt: plannerJson.image_prompt,
    });
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
  });
  broadcast(canvas, {
    type: SseEvents.DONE, canvasId: canvas.id, jobId, hash: node.hash, cacheHit,
  });
  return node;
}

// --------- Public: click → label → child node + parent hotspot append ---------
export async function expandFromClick(canvas, args = {}) {
  const jobId = args.jobId || nanoid(8);
  const { parentNode, clickXY, webSearchEnabled } = args;
  if (!parentNode || !Array.isArray(clickXY)) throw new Error('parentNode and clickXY required');

  // Spatial dedup: if there's already a hotspot near this click, jump to its child.
  const SPATIAL_THRESHOLD = 0.06;
  const near = await findNearbyHotspot({
    canvasId: canvas.id, parentHash: parentNode.hash,
    x: clickXY[0], y: clickXY[1], threshold: SPATIAL_THRESHOLD,
  });
  if (near?.childHash) {
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

  // 1) Label inference
  broadcast(canvas, {
    type: SseEvents.PLANNING_STARTED, canvasId: canvas.id, jobId,
    parentHash: parentNode.hash, hotspotIndex: null, label: null,
    clickXY,
  });

  const labelOut = await clickLabelCall({
    parentNode, clickXY,
    existingLabels: parentNode.hotspots ?? [],
  });

  // Semantic dedup: same label string already exists?
  const existing = (parentNode.hotspots ?? []).find(
    (h) => h.label?.trim().toLowerCase() === labelOut.label?.trim().toLowerCase(),
  );
  if (existing?.next_hash) {
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
  canvas.queue.enqueue(() => generateRootNode(canvas, { jobId, webSearchEnabled }).catch((e) => {
    log.error('generateRootNode failed:', e?.stack || e);
  }));
  return jobId;
}

// Click expansions: capped at MAX_PARALLEL_CLICKS_PER_NODE per (canvas, parent).
// Different parents and different canvases run in parallel. Excess clicks are
// queued in arrival order until a slot frees up.
export function enqueueClickExpansion(canvas, { parentNode, clickXY, webSearchEnabled }) {
  const jobId = nanoid(8);
  const key = clickKey(canvas.id, parentNode.hash);
  const enabled = webSearchEnabled !== false; // default on
  // Fire-and-forget; progress is reported via SSE.
  clickSem.run(key, () => expandFromClick(canvas, {
    parentNode, clickXY, jobId, webSearchEnabled: enabled,
  }))
    .catch((e) => log.error('expandFromClick failed:', e?.stack || e));
  // Surface queue stats so the route can echo them back to the client.
  return {
    jobId,
    queue: clickQueueStatus(canvas.id, parentNode.hash),
  };
}
