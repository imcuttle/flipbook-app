// Share-link routes — read-only public preview of a canvas.
//
// POST /api/canvas/:id/share         → create or reuse a token for this canvas
// GET  /api/share/:token             → resolve token to canvasId (+ canvas info)
//
// The actual canvas read endpoints (tree / nodes / images / events) are
// permissive (any caller knowing the canvasId can read). The token only proves
// the user is authorized to KNOW the canvasId; the frontend uses the
// existence of a token to enter "preview mode" (no clicks).
//
// Mutating endpoints (POST /api/canvas, POST .../click) reject when called
// from a preview session — but since v1 has no auth, this guard is enforced
// purely on the frontend by hiding/disabling the UI. The server still
// validates that no `?s=<token>` was needed to obtain the canvasId.
import express from 'express';
import { nanoid } from 'nanoid';
import { isSafeId } from '../store/paths.js';
import { getCanvas } from '../store/canvasStore.js';
import { createShareLink, resolveShareLink, findShareLinkForCanvas } from '../db/repo.js';

export const shareRouter = express.Router();

// POST /api/canvas/:id/share
shareRouter.post('/canvas/:id/share', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'not_found' });

  // Reuse existing non-expired token if present
  const existing = await findShareLinkForCanvas(id);
  if (existing && (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())) {
    return res.json({
      token: existing.token,
      canvasId: id,
      url: `/?s=${existing.token}`,
    });
  }

  const token = nanoid(16);
  await createShareLink({ canvasId: id, token, expiresAt: null });
  res.status(201).json({ token, canvasId: id, url: `/?s=${token}` });
});

// GET /api/share/:token
shareRouter.get('/share/:token', async (req, res) => {
  const { token } = req.params;
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return res.status(400).json({ error: 'bad_token' });
  const link = await resolveShareLink(token);
  if (!link) return res.status(404).json({ error: 'not_found_or_expired' });
  const runtime = await getCanvas(link.canvasId);
  if (!runtime) return res.status(404).json({ error: 'canvas_missing' });
  res.json({
    token,
    canvasId: link.canvasId,
    topic: runtime.topic,
    readOnly: true,
  });
});
