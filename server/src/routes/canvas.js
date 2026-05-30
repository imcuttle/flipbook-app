import express from 'express';
import { createCanvas, getCanvas, listCanvases } from '../store/canvasStore.js';
import { readTree } from '../store/treeStore.js';
import { isSafeId } from '../store/paths.js';
import { enqueueRootGeneration } from '../generation/pipeline.js';
import { normalizeLang } from '../generation/language.js';
import { uploadMemory, persistUpload } from './upload.js';

export const canvasRouter = express.Router();

canvasRouter.get('/', async (req, res) => {
  // Pagination — `limit` opts into the paginated shape `{items,total,hasMore}`.
  // Without `limit` the response stays a flat array (back-compat).
  // Cursor: lastCanvasId pulls the page after that row's createdAt+canvasId
  // keyset; offset is the fallback when the cursor row is missing or absent.
  const rawLimit = req.query?.limit;
  const rawOffset = req.query?.offset;
  const lastCanvasId = req.query?.lastCanvasId
    ? String(req.query.lastCanvasId).slice(0, 64)
    : undefined;
  if (rawLimit !== undefined) {
    const limit = Math.max(1, Math.min(100, Number(rawLimit) || 24));
    const offset = Math.max(0, Number(rawOffset) || 0);
    const page = await listCanvases({ limit, offset, lastCanvasId });
    return res.json(page);
  }
  const list = await listCanvases();
  res.json(list);
});

canvasRouter.post('/', async (req, res) => {
  const { topic, branches, webSearch } = req.body || {};
  const lang = normalizeLang(req.body?.lang);
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'topic_required' });
  }
  try {
    const runtime = await createCanvas({ topic: topic.trim(), branches: Number(branches) || 5 });
    // webSearch is an opt-out boolean; default true.
    const webSearchEnabled = webSearch !== false;
    const jobId = enqueueRootGeneration(runtime, { webSearchEnabled, lang });
    res.status(201).json({
      canvasId: runtime.id,
      eventsUrl: `/api/canvas/${runtime.id}/events`,
      jobId,
    });
  } catch (e) {
    res.status(500).json({ error: 'create_failed', message: e?.message });
  }
});

// Multipart upload variant — accepts a topic + a single image file.
// Image is persisted under data/canvases/<id>/uploads/seed.<ext> and
// passed to the planner via seedImagePath so the generated diagram
// preserves the user's content/composition and only restyles + annotates.
canvasRouter.post('/upload', uploadMemory.single('image'), async (req, res) => {
  const topicRaw = (req.body?.topic ?? '').toString();
  const topic = topicRaw.trim();
  const lang = normalizeLang(req.body?.lang);
  // Topic is optional when an image is supplied — but we still need a
  // string to seed the canvas slug, so fall back to a sentinel that the
  // client localises into "内容生成中… / Content generating…". The
  // describe-first step will replace this with the inferred subject as
  // soon as the planner runs.
  const file = req.file;
  if (!topic && !file) {
    return res.status(400).json({ error: 'topic_or_image_required' });
  }
  const webSearchEnabled = req.body?.webSearch !== '0' && req.body?.webSearch !== false;
  try {
    const finalTopic = topic || '__pending__';
    const runtime = await createCanvas({ topic: finalTopic });
    let seedImagePath = null;
    if (file) {
      seedImagePath = await persistUpload(runtime.id, 'seed', file);
    }
    const jobId = enqueueRootGeneration(runtime, { webSearchEnabled, seedImagePath, lang });
    res.status(201).json({
      canvasId: runtime.id,
      eventsUrl: `/api/canvas/${runtime.id}/events`,
      jobId,
    });
  } catch (e) {
    res.status(500).json({ error: 'create_failed', message: e?.message });
  }
});

canvasRouter.get('/:id/tree', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const tree = await readTree(id);
    res.json(tree);
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});

canvasRouter.get('/:id/manifest', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'not_found' });
  res.json({
    canvasId: runtime.id,
    topic: runtime.topic,
    slug: runtime.slug,
    branches: runtime.branches,
    createdAt: runtime.createdAt,
  });
});
