import express from 'express';
import { getCanvas } from '../store/canvasStore.js';
import { isSafeId, isSafeHash } from '../store/paths.js';
import { readNode, nodeExists } from '../store/nodeStore.js';
import { enqueueClickExpansion } from '../generation/pipeline.js';
import { deleteNodeCascade } from '../generation/deleteNode.js';
import { regenerateNode } from '../generation/regenerateNode.js';
import { cancelHotspot } from '../generation/cancelHotspot.js';
import { uploadMemory, persistUpload } from './upload.js';
import { normalizeLang } from '../generation/language.js';
import { nanoid } from 'nanoid';

export const clickRouter = express.Router();

// POST /api/canvas/:id/click  body: {parentHash, x, y, webSearch?}
clickRouter.post('/:id/click', async (req, res) => {
  const { id } = req.params;
  const { parentHash, x, y, webSearch } = req.body || {};
  const lang = normalizeLang(req.body?.lang);
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
    parentNode, clickXY: [cx, cy], webSearchEnabled, lang,
  });
  res.status(202).json({
    jobId: result.jobId,
    parentHash,
    clickXY: [cx, cy],
    queue: result.queue,
  });
});

// DELETE /api/canvas/:id/nodes/:hash  → cascade-delete a node + descendants.
clickRouter.delete('/:id/nodes/:hash', async (req, res) => {
  const { id, hash } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isSafeHash(hash)) return res.status(400).json({ error: 'bad_hash' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'canvas_not_found' });
  try {
    const result = await deleteNodeCascade(runtime, hash);
    if (result.deletedHashes.length === 0) {
      return res.status(404).json({ error: 'node_not_found' });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'delete_failed', message: e?.message });
  }
});

// POST /api/canvas/:id/nodes/:hash/regenerate
//   Cascade-delete the node's descendants (and the node itself for non-
//   root re-rolls; root nodes get their image+JSON dropped too) and
//   re-enqueue the same drilldown so the user can re-roll a result they
//   don't like. Replays the EXACT inputs (parent + click_xy + user_label
//   + seed_image) recorded on the node's gen_inputs field. Web search
//   for the new pass uses the caller's current toggle (request body's
//   `webSearch`), NOT the persisted value — this matches user intent
//   when the toggle has been flipped since the original generation.
clickRouter.post('/:id/nodes/:hash/regenerate', async (req, res) => {
  const { id, hash } = req.params;
  const lang = normalizeLang(req.body?.lang);
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isSafeHash(hash)) return res.status(400).json({ error: 'bad_hash' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'canvas_not_found' });
  // webSearch is opt-out — undefined means "use the persisted value";
  // explicit boolean from the UI overrides.
  const webSearchEnabled = typeof req.body?.webSearch === 'boolean'
    ? req.body.webSearch
    : (req.body?.webSearch === '0' || req.body?.webSearch === 'false')
      ? false
      : (req.body?.webSearch === '1' || req.body?.webSearch === 'true')
        ? true
        : undefined;
  try {
    const result = await regenerateNode(runtime, hash, { webSearchEnabled, lang });
    if (!result.ok) return res.status(404).json({ error: 'regenerate_failed', reason: result.reason });
    res.status(202).json(result);
  } catch (e) {
    res.status(500).json({ error: 'regenerate_failed', message: e?.message });
  }
});

// POST /api/canvas/:id/nodes/:parentHash/hotspots/:index/cancel
//   Drop a still-generating hotspot from the parent. The in-flight
//   generation job will finish on its own and write an orphan child
//   that boot-time sweep cleans up next restart — the user just stops
//   seeing the pending bubble.
clickRouter.post('/:id/nodes/:parentHash/hotspots/:index/cancel', async (req, res) => {
  const { id, parentHash, index } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isSafeHash(parentHash)) return res.status(400).json({ error: 'bad_parent_hash' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'canvas_not_found' });
  try {
    const result = await cancelHotspot(runtime, parentHash, index);
    if (!result.ok) return res.status(404).json({ error: 'cancel_failed', reason: result.reason });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'cancel_failed', message: e?.message });
  }
});

// Multipart click variant — accepts the same {parentHash, x, y, webSearch}
// as the JSON route, plus an optional `label` text override and a single
// image attachment. When an image is attached, the child node is
// generated as a stylised + annotated derivative of the user's image
// instead of from scratch.
clickRouter.post('/:id/click/upload', uploadMemory.single('image'), async (req, res) => {
  const { id } = req.params;
  const parentHash = (req.body?.parentHash ?? '').toString();
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  const userLabel = (req.body?.label ?? '').toString().trim() || null;
  const lang = normalizeLang(req.body?.lang);
  const webSearchEnabled = req.body?.webSearch !== '0' && req.body?.webSearch !== false;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isSafeHash(parentHash)) return res.status(400).json({ error: 'bad_parent_hash' });
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
    return res.status(400).json({ error: 'bad_xy' });
  }
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'canvas_not_found' });
  if (!(await nodeExists(id, parentHash))) {
    return res.status(404).json({ error: 'parent_not_found' });
  }
  const parentNode = await readNode(id, parentHash);
  let seedImagePath = null;
  if (req.file) {
    // Use a per-click filename so concurrent clicks don't trample each
    // other's uploads. The basename is shared with the jobId we'll mint
    // inside enqueueClickExpansion — but we don't know it yet, so use a
    // fresh nanoid here and pass it through.
    const basename = `click-${nanoid(8)}`;
    seedImagePath = await persistUpload(id, basename, req.file);
  }
  const result = enqueueClickExpansion(runtime, {
    parentNode, clickXY: [x, y], webSearchEnabled,
    seedImagePath, userLabel, lang,
  });
  res.status(202).json({
    jobId: result.jobId,
    parentHash,
    clickXY: [x, y],
    queue: result.queue,
  });
});
