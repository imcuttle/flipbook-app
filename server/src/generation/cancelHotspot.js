// Cancel a still-generating hotspot — drop the pending entry from the
// parent's hotspots[] array and broadcast a node_deleted-shaped SSE so
// the frontend reducer prunes its in-memory state.
//
// Used when the user wants to abandon an in-flight click before the
// child node finishes generating. The child node JSON probably doesn't
// exist yet (or is half-written), so this isn't a cascade — we only
// touch the parent's hotspots[] and the corresponding pendingClick on
// the client side.
//
// The server-side generation job that's still running (callOnce →
// callImageGen) will finish on its own and write the child node;
// resumeIncomplete will sweep that orphan on the next SSE attach. We
// don't try to actually kill the in-flight subprocess because cancelling
// mid-stream gets messy and the orphan is cheap to clean up later.
import { readNode, writeNode } from '../store/nodeStore.js';
import { broadcast } from '../sse/hub.js';
import { SseEvents } from '../sse/events.js';
import { log } from '../lib/log.js';

export async function cancelHotspot(canvas, parentHash, index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    return { ok: false, reason: 'bad_index' };
  }
  let parent;
  try { parent = await readNode(canvas.id, parentHash); } catch (e) {
    return { ok: false, reason: `parent ${parentHash} unreadable: ${e?.message}` };
  }
  const hotspots = Array.isArray(parent.hotspots) ? parent.hotspots : [];
  if (!hotspots[idx]) return { ok: false, reason: 'hotspot_not_found' };
  const removed = hotspots[idx];
  // Remove and rewrite atomically.
  parent.hotspots = hotspots.filter((_, i) => i !== idx);
  await writeNode(canvas.id, parent);
  log.info(`[cancel-hotspot] ${canvas.id}/${parentHash}[${idx}] dropped "${removed?.label ?? ''}"`);
  // Broadcast a NODE_DELETED so the frontend's reducer prunes any
  // in-memory child entry (if any was speculatively created) and the
  // catalog popover refreshes. deletedHashes intentionally only carries
  // a real hash — for purely-pending hotspots there's nothing to delete
  // beyond the parent rewrite. We also send the cancelled hotspot's
  // label and the parent hash so the reducer can filter the matching
  // pending entry out of state.nodes[parent].hotspots and drop any
  // matching pendingClick from state.pendingClicks.
  const deletedHashes = removed?.next_hash ? [removed.next_hash] : [];
  try {
    broadcast(canvas, {
      type: SseEvents.NODE_DELETED,
      canvasId: canvas.id,
      hash: removed?.next_hash ?? null,
      deletedHashes,
      parentHash,
      cancelledHotspot: {
        parentHash,
        label: removed?.label ?? null,
        anchorXY: removed?.anchor_xy ?? null,
        leaderXY: removed?.leader_xy ?? null,
      },
    });
  } catch { /* logged in hub */ }
  return { ok: true, parentHash, hotspotIndex: idx, deletedHashes, label: removed?.label ?? null };
}
