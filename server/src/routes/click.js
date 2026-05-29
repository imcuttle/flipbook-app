import express from 'express';
import { getCanvas } from '../store/canvasStore.js';
import { isSafeId, isSafeHash } from '../store/paths.js';
import { readNode, nodeExists } from '../store/nodeStore.js';
import { enqueueClickExpansion } from '../generation/pipeline.js';

export const clickRouter = express.Router();

// POST /api/canvas/:id/click  body: {parentHash, x, y, webSearch?}
clickRouter.post('/:id/click', async (req, res) => {
  const { id } = req.params;
  const { parentHash, x, y, webSearch } = req.body || {};
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isSafeHash(parentHash)) return res.status(400).json({ error: 'bad_parent_hash' });
  const cx = Number(x);
  const cy = Number(y);
  if (!(cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1)) {
    return res.status(400).json({ error: 'bad_xy' });
  }
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'canvas_not_found' });
  if (!(await nodeExists(id, parentHash))) {
    return res.status(404).json({ error: 'parent_not_found' });
  }
  const parentNode = await readNode(id, parentHash);
  // webSearch is an opt-out boolean; default true.
  const webSearchEnabled = webSearch !== false;
  const result = enqueueClickExpansion(runtime, {
    parentNode, clickXY: [cx, cy], webSearchEnabled,
  });
  res.status(202).json({
    jobId: result.jobId,
    parentHash,
    clickXY: [cx, cy],
    queue: result.queue,
  });
});
