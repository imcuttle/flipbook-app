// Tracks generation hashes that have been deleted so in-flight async
// post-processing (image variants, OCR) can bail before persisting or
// broadcasting a node the user already removed.
//
// Why: variant + OCR work is fire-and-forget (see pipeline.js). If a node is
// deleted while that work is still running, its completion would re-write the
// node JSON / re-broadcast node_ready — effectively resurrecting a deleted
// node on disk and in the client. We record cancelled hashes here and the
// async continuations consult `isHashCancelled` before doing any write.
//
// Keyed by `${canvasId}:${hash}`. We keep a bounded set (most recent N) so a
// long-lived server doesn't grow this unboundedly — a cancelled hash only
// needs to outlive the in-flight async work that races with it (seconds).

const MAX = 500;
const cancelled = new Set();

function key(canvasId, hash) { return `${canvasId}:${hash}`; }

export function cancelHashWork(canvasId, hash) {
  const k = key(canvasId, hash);
  cancelled.add(k);
  // Bound the set: drop oldest insertions once over capacity (Set preserves
  // insertion order, so the first entries are the oldest).
  if (cancelled.size > MAX) {
    const drop = cancelled.size - MAX;
    let i = 0;
    for (const v of cancelled) {
      cancelled.delete(v);
      if (++i >= drop) break;
    }
  }
}

export function isHashCancelled(canvasId, hash) {
  return cancelled.has(key(canvasId, hash));
}
