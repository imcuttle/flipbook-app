import express from 'express';
import { createCanvas, getCanvas, listCanvases } from '../store/canvasStore.js';
import { readTree } from '../store/treeStore.js';
import { isSafeId } from '../store/paths.js';
import { enqueueRootGeneration } from '../generation/pipeline.js';

export const canvasRouter = express.Router();

canvasRouter.get('/', async (_req, res) => {
  const list = await listCanvases();
  res.json(list);
});

canvasRouter.post('/', async (req, res) => {
  const { topic, branches, webSearch } = req.body || {};
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'topic_required' });
  }
  try {
    const runtime = await createCanvas({ topic: topic.trim(), branches: Number(branches) || 5 });
    // webSearch is an opt-out boolean; default true.
    const webSearchEnabled = webSearch !== false;
    const jobId = enqueueRootGeneration(runtime, { webSearchEnabled });
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
