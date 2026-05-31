import express from 'express';
import { getCanvas } from '../store/canvasStore.js';
import { attach, broadcast } from '../sse/hub.js';
import { SseEvents } from '../sse/events.js';
import { isSafeId } from '../store/paths.js';
import { resumeIncomplete } from '../generation/resume.js';

export const eventsRouter = express.Router();

eventsRouter.get('/:id/events', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  const runtime = await getCanvas(id);
  if (!runtime) return res.status(404).json({ error: 'not_found' });
  // Last-Event-ID lets a briefly-disconnected client replay the frames it
  // missed. Standard EventSource sends it as a request header on native
  // auto-reconnect; our manual reconnect (useCanvasSSE) can't set headers
  // on EventSource, so it passes ?lastEventId= as a query param. Accept
  // either, preferring the header (native reconnect path).
  const lastEventId = req.get('Last-Event-ID') ?? req.query.lastEventId ?? null;
  attach(runtime, res, lastEventId);
  // If a ROOT generation is currently in flight (no persisted node yet),
  // re-send planning_started so a freshly-(re)connected client restores
  // its in-progress UI instead of showing a blank "生成中…". planning_started
  // is idempotent in the reducer, so re-emitting to already-connected
  // clients is harmless.
  if (runtime.rootInFlight) {
    try {
      broadcast(runtime, {
        type: SseEvents.PLANNING_STARTED,
        canvasId: runtime.id,
        jobId: runtime.rootInFlight.jobId,
        parentHash: null,
        hotspotIndex: null,
        label: runtime.rootInFlight.topic ?? runtime.topic,
      });
    } catch { /* logged in hub */ }
  }
  // After the client is attached, look for any half-finished generation
  // jobs (parent hotspots whose target node is missing/imageless, or a
  // tree.root that never got its image written) and re-enqueue them so
  // the user's "still generating…" UI eventually receives node_ready.
  // Per-canvas dedupe inside resumeIncomplete() handles concurrent SSE
  // attaches.
  resumeIncomplete(runtime).catch(() => { /* logged inside */ });
});
