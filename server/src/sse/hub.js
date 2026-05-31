// Per-canvas SSE hub. attach(canvasId, res) adds the response stream;
// broadcast(canvasId, evt) writes to all attached streams.
//
// Last-Event-ID replay: every frame carries a monotonic `id:`. We keep a
// small per-canvas ring buffer of recent frames so a client that briefly
// drops its connection can reconnect with Last-Event-ID (header or
// ?lastEventId= query) and have the events it missed replayed, rather than
// silently losing them. Reconnects are fast (client backoff starts at 1s),
// so the buffer only needs to cover a short window.
import { log } from '../lib/log.js';

let nextId = 1;

// Max frames retained per canvas for replay. node_ready frames embed a full
// node, so keep this modest; a 1–30s reconnect gap rarely spans more than a
// handful of events.
const REPLAY_BUFFER_MAX = 100;

export function attach(canvasRuntime, res, lastEventId = null) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  // Hello frame so clients confirm connection
  res.write(`: connected ${canvasRuntime.id}\n\n`);

  // Replay any frames the client missed while disconnected. We do this
  // BEFORE adding res to sseClients so a concurrent broadcast can't
  // interleave a live frame ahead of the replayed backlog (which would
  // deliver events out of id order).
  if (lastEventId != null) {
    const since = Number(lastEventId);
    const buf = canvasRuntime.sseBuffer;
    if (Number.isFinite(since) && Array.isArray(buf) && buf.length) {
      let replayed = 0;
      for (const frame of buf) {
        if (frame.id > since) {
          try { res.write(frame.payload); replayed++; } catch { /* ignore */ }
        }
      }
      if (replayed) {
        log.info(`[sse] replayed ${replayed} event(s) to reconnecting client (since id=${since}) canvas=${canvasRuntime.id}`);
      }
    }
  }

  canvasRuntime.sseClients.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25_000);
  // Don't let the heartbeat timer keep the process alive on shutdown.
  heartbeat.unref?.();

  const cleanup = () => {
    clearInterval(heartbeat);
    canvasRuntime.sseClients.delete(res);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function broadcast(canvasRuntime, evt) {
  const id = nextId++;
  const payload = `id: ${id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
  // Retain in the per-canvas ring buffer for Last-Event-ID replay. Lazily
  // created so runtimes built before this field existed still work.
  const buf = (canvasRuntime.sseBuffer ??= []);
  buf.push({ id, payload });
  if (buf.length > REPLAY_BUFFER_MAX) buf.splice(0, buf.length - REPLAY_BUFFER_MAX);
  for (const res of canvasRuntime.sseClients) {
    try { res.write(payload); }
    catch (e) { log.warn('sse write failed:', e?.message); }
  }
}
