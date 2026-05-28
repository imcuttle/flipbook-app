import express from 'express';
import { getCanvas } from '../store/canvasStore.js';
import { attach } from '../sse/hub.js';
import { isSafeId } from '../store/paths.js';

export const eventsRouter = express.Router();

eventsRouter.get('/:id/events', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'not_found' });
  attach(runtime, res);
});
