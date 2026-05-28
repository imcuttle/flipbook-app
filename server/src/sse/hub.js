// Per-canvas SSE hub. attach(canvasId, res) adds the response stream;
// broadcast(canvasId, evt) writes to all attached streams.
import { log } from '../lib/log.js';

let nextId = 1;

export function attach(canvasRuntime, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  // Hello frame so clients confirm connection
  res.write(`: connected ${canvasRuntime.id}\n\n`);
  canvasRuntime.sseClients.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25_000);

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
  for (const res of canvasRuntime.sseClients) {
    try { res.write(payload); }
    catch (e) { log.warn('sse write failed:', e?.message); }
  }
}
