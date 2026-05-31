// Resume in-flight node generation when an SSE client reconnects.
//
// If the server crashes / restarts mid-generation, the next boot's sweep
// (server/src/store/sweep.js) drops incomplete nodes from disk + DB. But
// the user's BROWSER state may still show an in-flight click — pendingClicks
// in the reducer for jobs that don't exist server-side any more.
//
// The cleanest UX is for the server, on the first SSE attach to a canvas
// after sweep, to RE-ENQUEUE the generation jobs that were interrupted.
// We approximate the original click by re-using the parent hotspot's
// leader_xy (≈ click point) and label (so the click-label LLM doesn't
// even need to re-infer — userLabel skips that call).
//
// Single-process only — a per-(canvasId) lock prevents repeated SSE
// connections from queueing duplicate resume jobs.
import fs from 'node:fs/promises';
import { paths } from '../store/paths.js';
import { readNode, nodeExists } from '../store/nodeStore.js';
import { readTree } from '../store/treeStore.js';
import { enqueueRootGeneration, enqueueClickExpansion, isClickInFlight, getClickInFlight } from '../generation/pipeline.js';
import { broadcast } from '../sse/hub.js';
import { SseEvents } from '../sse/events.js';
import { log } from '../lib/log.js';

// Re-emit planning_started for an in-flight click so a reconnecting client
// rebuilds its pending bubble (black pill) without us starting a duplicate
// generation. Idempotent on the client.
function replayPlanningStarted(canvas, parentHash, label) {
  const inf = getClickInFlight(canvas.id, parentHash, label);
  if (!inf) return;
  try {
    broadcast(canvas, {
      type: SseEvents.PLANNING_STARTED,
      canvasId: canvas.id,
      jobId: inf.jobId,
      parentHash,
      hotspotIndex: null,
      label,
      clickXY: inf.clickXY,
    });
  } catch { /* logged in hub */ }
}

// Per-canvas guard so multiple concurrent SSE attaches don't re-enqueue
// the same set of resume jobs.
const inFlight = new Set();

async function imageOk(canvasId, hash) {
  for (const ext of ['png', 'svg']) {
    try {
      const s = await fs.stat(paths.imagePath(canvasId, hash, ext));
      if (s.size > 0) return true;
    } catch { /* ignore */ }
  }
  return false;
}

async function nodeIsComplete(canvasId, hash) {
  if (!(await nodeExists(canvasId, hash))) return false;
  let node;
  try { node = await readNode(canvasId, hash); } catch { return false; }
  if (!node?.image) return false;
  if (!node?.generated_at) return false;
  return imageOk(canvasId, hash);
}

export async function resumeIncomplete(canvas) {
  if (inFlight.has(canvas.id)) return { resumed: 0 };
  inFlight.add(canvas.id);
  let resumed = 0;
  try {
    const tree = await readTree(canvas.id).catch(() => null);
    if (!tree?.nodes) return { resumed: 0 };

    // Case 1: root node missing or incomplete.
    if (tree.root && !(await nodeIsComplete(canvas.id, tree.root))) {
      log.info(`[resume] ${canvas.id}: root ${tree.root} incomplete — re-enqueueing root generation`);
      // Drop the orphan tree.root entry so the new generateRootNode
      // produces a fresh hash; otherwise hashNode is deterministic and
      // would just collide. The sweep on next boot would do this anyway,
      // but we duplicate the cleanup here for the live-resume path.
      // (The simpler thing: just enqueue and let the cache hit if the
      // node actually IS complete.)
      // Resume must not delete the canvas on failure — it's an existing
      // (interrupted) flipbook, not a fresh creation.
      enqueueRootGeneration(canvas, { deleteOnFailure: false });
      resumed++;
    }

    // Case 2: parent hotspots whose child node is missing / incomplete.
    // Two sub-cases:
    //   (a) linked hotspot (next_hash set) but child JSON missing/imageless
    //       — re-drive by hash.
    //   (b) PENDING hotspot (next_hash null) — the click was appended to
    //       the parent before the server died/refresh interrupted it, so
    //       the child never finished. Re-drive in place by hotspot index
    //       (resumeHotspotIndex) so we don't append a duplicate hotspot.
    // Both re-emit planning_started (with leader_xy as clickXY) so a
    // freshly-reconnected client rebuilds its pending bubble.
    for (const [parentHash, meta] of Object.entries(tree.nodes)) {
      // Only process parents whose own JSON exists (otherwise re-running
      // the click would crash on the missing parent).
      if (!(await nodeIsComplete(canvas.id, parentHash))) continue;
      let parent;
      try { parent = await readNode(canvas.id, parentHash); } catch { continue; }
      if (!Array.isArray(parent.hotspots)) continue;
      for (let idx = 0; idx < parent.hotspots.length; idx++) {
        const h = parent.hotspots[idx];
        const childHash = h?.next_hash;
        const clickXY = Array.isArray(h?.leader_xy)
          ? [Number(h.leader_xy[0]), Number(h.leader_xy[1])]
          : [0.5, 0.5];

        if (childHash) {
          // (a) linked but child incomplete.
          if (await nodeIsComplete(canvas.id, childHash)) continue;
          if (isClickInFlight(canvas.id, parentHash, h.label)) {
            // Original job still running (browser refreshed, server didn't
            // restart) — don't duplicate; just replay planning_started so
            // the reconnecting client restores the pending bubble.
            replayPlanningStarted(canvas, parentHash, h.label);
            continue;
          }
          log.info(`[resume] ${canvas.id}: child ${childHash} of ${parentHash} incomplete — re-driving in place`);
          enqueueClickExpansion(canvas, {
            parentNode: parent,
            clickXY,
            webSearchEnabled: parent.web_search_used !== false,
            userLabel: h.label,
            // Reuse the existing hotspot slot (don't append a new one) —
            // otherwise the catalog accrues duplicate entries on each resume.
            resumeHotspotIndex: idx,
          });
          resumed++;
        } else {
          // (b) pending hotspot — child never started/finished. Re-drive
          // in place so the spinner card eventually links to a real child
          // and the pending bubble reappears. BUT skip if the original
          // generation is still running (e.g. browser refreshed without a
          // server restart) — otherwise we'd duplicate the child node.
          if (isClickInFlight(canvas.id, parentHash, h.label)) {
            log.info(`[resume] ${canvas.id}: pending hotspot[${idx}] "${h.label}" still in-flight — replay planning_started`);
            replayPlanningStarted(canvas, parentHash, h.label);
            continue;
          }
          log.info(`[resume] ${canvas.id}: pending hotspot[${idx}] "${h.label}" of ${parentHash} — re-driving in place`);
          enqueueClickExpansion(canvas, {
            parentNode: parent,
            clickXY,
            webSearchEnabled: parent.web_search_used !== false,
            userLabel: h.label,
            resumeHotspotIndex: idx,
          });
          resumed++;
        }
      }
    }
  } catch (e) {
    log.warn(`[resume] ${canvas.id} failed: ${e?.message}`);
  } finally {
    inFlight.delete(canvas.id);
  }
  return { resumed };
}
