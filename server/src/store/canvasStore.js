import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { paths } from './paths.js';
import { writeJsonAtomic } from './treeStore.js';
import { slugify } from '../lib/slug.js';
import { PerCanvasQueue } from '../generation/queue.js';
import { upsertCanvasMeta, touchCanvas, listCanvasesFromDb } from '../db/repo.js';

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

export async function createCanvas({ topic, branches = 5 }) {
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    throw new Error('topic required');
  }
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
    nodes: {},
  };
  await writeJsonAtomic(paths.treePath(id), tree);

  const manifest = {
    canvasId: id,
    topic,
    slug,
    branches,
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
    queue: new PerCanvasQueue(),
    sseClients: new Set(),
    createdAt: now,
  };
  runtimes.set(id, runtime);
  return runtime;
}

export async function listCanvases() {
  await ensureCanvasesRoot();
  // Read from DB (kept in sync with disk by hydrate on boot + register hooks)
  return listCanvasesFromDb();
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
    queue: new PerCanvasQueue(),
    sseClients: new Set(),
    createdAt: manifest.created_at,
  };
  runtimes.set(id, runtime);
  return runtime;
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
