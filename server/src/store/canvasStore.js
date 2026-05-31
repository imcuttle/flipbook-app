import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { paths } from './paths.js';
import { writeJsonAtomic } from './treeStore.js';
import { slugify } from '../lib/slug.js';
import { PerCanvasQueue } from '../generation/queue.js';
import { upsertCanvasMeta, touchCanvas, listCanvasesFromDb, countCanvases, deleteCanvasFromDb } from '../db/repo.js';

// In-memory runtime registry. Disk is the source of truth for "what canvases exist".
// Memory is the source of truth for "who is listening" and "what jobs are queued".
const runtimes = new Map();

export async function ensureCanvasesRoot() {
  await fs.mkdir(paths.canvasesRoot(), { recursive: true });
}

async function ensureCanvasDirs(id) {
  const dir = paths.canvasDir(id);
  await fs.mkdir(path.join(dir, 'data', 'nodes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'images'), { recursive: true });
}

export async function createCanvas({ topic, branches = 5, orientation = 'landscape' }) {
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    throw new Error('topic required');
  }
  // Only 'portrait' is special; anything else normalises to landscape.
  const orient = orientation === 'portrait' ? 'portrait' : 'landscape';
  await ensureCanvasesRoot();
  const id = nanoid(12);
  const slug = slugify(topic);
  await ensureCanvasDirs(id);

  const now = new Date().toISOString();
  const tree = {
    topic,
    topic_slug: slug,
    root: null,
    branches,
    style: 'isometric-illustration',
    orientation: orient,
    nodes: {},
  };
  await writeJsonAtomic(paths.treePath(id), tree);

  const manifest = {
    canvasId: id,
    topic,
    slug,
    branches,
    orientation: orient,
    created_at: now,
    last_run_at: now,
  };
  await writeJsonAtomic(paths.manifestPath(id), manifest);
  await writeJsonAtomic(paths.pendingPath(id), []);

  // Record in DB (idempotent upsert)
  await upsertCanvasMeta({
    canvasId: id, topic, slug, branches,
    createdAt: new Date(now), lastRunAt: new Date(now),
  });

  const runtime = {
    id,
    topic,
    slug,
    branches,
    orientation: orient,
    queue: new PerCanvasQueue(),
    sseClients: new Set(),
    createdAt: now,
  };
  runtimes.set(id, runtime);
  return runtime;
}

export async function listCanvases({ limit, offset, lastCanvasId } = {}) {
  await ensureCanvasesRoot();
  const items = await listCanvasesFromDb({ limit, offset, lastCanvasId });
  // Caller may want pagination metadata when limit is set; otherwise just
  // return the array (back-compat with non-paginated callers).
  if (typeof limit === 'number') {
    const total = await countCanvases();
    // hasMore is true when we filled the page exactly — there *might* be
    // more behind the cursor. False when we got fewer than `limit` rows
    // (definitely the last page).
    const hasMore = items.length === limit;
    return { items, total, hasMore };
  }
  return items;
}

export async function getCanvas(id) {
  if (runtimes.has(id)) return runtimes.get(id);
  // Hydrate from disk
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(paths.manifestPath(id), 'utf8'));
  } catch { return null; }
  const runtime = {
    id,
    topic: manifest.topic,
    slug: manifest.slug,
    branches: manifest.branches ?? 5,
    // Legacy canvases (created before orientation existed) default to
    // landscape.
    orientation: manifest.orientation === 'portrait' ? 'portrait' : 'landscape',
    queue: new PerCanvasQueue(),
    sseClients: new Set(),
    createdAt: manifest.created_at,
  };
  runtimes.set(id, runtime);
  return runtime;
}

// Delete an entire canvas: DB rows, the in-memory runtime, and the
// on-disk directory (nodes, images, uploads, manifest, tree). Returns
// true if a directory was found and removed. Idempotent — deleting a
// non-existent canvas resolves false rather than throwing.
export async function deleteCanvas(id) {
  // Drop the in-memory runtime first so no new SSE writes / jobs target it.
  const rt = runtimes.get(id);
  if (rt?.sseClients) {
    for (const res of rt.sseClients) {
      try { res.end(); } catch { /* ignore */ }
    }
  }
  runtimes.delete(id);
  try { await deleteCanvasFromDb(id); } catch { /* best effort */ }
  let removed = false;
  try {
    await fs.rm(paths.canvasDir(id), { recursive: true, force: true });
    removed = true;
  } catch { /* ignore */ }
  return removed;
}

export async function touchLastRun(id) {
  try {
    const raw = await fs.readFile(paths.manifestPath(id), 'utf8');
    const m = JSON.parse(raw);
    m.last_run_at = new Date().toISOString();
    await writeJsonAtomic(paths.manifestPath(id), m);
  } catch { /* ignore */ }
  // Also bump DB
  try { await touchCanvas(id); } catch { /* ignore */ }
}

// When a canvas was created with a sentinel topic ('__pending__' for
// image-only uploads), patch the canvas's manifest + DB row + in-memory
// runtime to the real subject once the planner has inferred it.
export async function updateCanvasTopic(id, topic) {
  if (!topic || typeof topic !== 'string') return;
  const trimmed = topic.trim();
  if (!trimmed) return;
  try {
    const raw = await fs.readFile(paths.manifestPath(id), 'utf8');
    const m = JSON.parse(raw);
    m.topic = trimmed;
    await writeJsonAtomic(paths.manifestPath(id), m);
  } catch { /* ignore */ }
  // Patch the in-memory runtime so /api/canvas/:id/manifest and the
  // SSE subject line stay consistent without a server restart.
  const rt = runtimes.get(id);
  if (rt) rt.topic = trimmed;
  // Also update the tree's stored topic so reload from disk picks it up.
  try {
    const treeRaw = await fs.readFile(paths.treePath(id), 'utf8');
    const tree = JSON.parse(treeRaw);
    tree.topic = trimmed;
    await writeJsonAtomic(paths.treePath(id), tree);
  } catch { /* ignore */ }
  // DB topic — best-effort; falls back to what hydrate does on next boot.
  try { await touchCanvas(id, { topic: trimmed }); } catch { /* ignore */ }
}
