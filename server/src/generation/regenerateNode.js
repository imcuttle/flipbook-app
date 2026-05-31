// Regenerate the current node — cascade-delete its descendants and
// re-enqueue the node's own generation so the user can re-roll a result
// they don't like. Replays the EXACT context that produced the node:
//
//   * For non-root nodes: uses node.gen_inputs (parent_hash, click_xy,
//     user_label, seed_image) recorded by expandFromClick. This means
//     the re-roll uses the same parent, click point on that parent's
//     image, the user's typed label override (if any), and the seed
//     image they uploaded — not just a hotspot's stripped-down record.
//   * For root nodes: replays the seed image (canvas was created with
//     it via /upload) and re-enqueues generateRootNode.
//   * webSearchEnabled is the CALLER's choice (UI passes the current
//     toggle state) rather than the persisted node.web_search_used.
//
// Falls back to the parent's hotspot record (leader_xy + label) when
// gen_inputs is absent — for legacy nodes generated before gen_inputs
// was a thing.
import { readNode, nodeExists } from '../store/nodeStore.js';
import { readTree } from '../store/treeStore.js';
import { updateCanvasTopic } from '../store/canvasStore.js';
import { deleteNodeCascade } from './deleteNode.js';
import { enqueueClickExpansion, enqueueRootGeneration } from './pipeline.js';
import { log } from '../lib/log.js';

export async function regenerateNode(canvas, hash, opts = {}) {
  if (!hash) return { ok: false, reason: 'hash required' };
  if (!(await nodeExists(canvas.id, hash))) {
    return { ok: false, reason: 'node not found' };
  }
  const tree = await readTree(canvas.id).catch(() => null);
  if (!tree?.nodes?.[hash]) return { ok: false, reason: 'node not in tree' };

  const node = await readNode(canvas.id, hash);
  const parentHash = tree.nodes[hash].parent ?? null;

  // webSearchEnabled comes from the current UI state (caller passes it
  // alongside the regenerate request); fall back to the persisted node
  // value when the caller didn't specify.
  const webSearchEnabled = typeof opts.webSearchEnabled === 'boolean'
    ? opts.webSearchEnabled
    : node.web_search_used !== false;

  if (!parentHash) {
    // ROOT regenerate: cascade-delete every child of root + the root
    // itself, then re-enqueue root generation with the same seed image
    // (which was attached to the canvas at creation time and persists
    // on the root node's seed_image field).
    const childHashes = (tree.nodes[hash].children ?? []).slice();
    for (const c of childHashes) {
      try { await deleteNodeCascade(canvas, c); } catch (e) { log.warn(`regenerate root: delete child ${c}: ${e?.message}`); }
    }
    try {
      await deleteNodeCascade(canvas, hash);
    } catch (e) {
      log.warn(`regenerate root: delete root ${hash}: ${e?.message}`);
    }
    // Restore the ORIGINAL topic input before re-running the planner. After
    // the first generation, the planner overwrote canvas.topic with the
    // inferred title (pipeline.js updateCanvasTopic). If we re-rolled with
    // that, an image-only canvas (user_topic=null) would suddenly gain a
    // topic it never had — and a text canvas would drift to the inferred
    // title instead of the user's words. node.gen_inputs.user_topic holds
    // the real original (null ⇒ image-only ⇒ restore the '__pending__'
    // sentinel). Legacy nodes without gen_inputs keep canvas.topic as-is.
    const gi = node.gen_inputs ?? null;
    let originalTopic = null;
    if (gi && 'user_topic' in gi) {
      originalTopic = gi.user_topic ?? '__pending__';
      canvas.topic = originalTopic;
      try { await updateCanvasTopic(canvas.id, originalTopic); } catch { /* non-fatal; planner re-titles */ }
    }
    enqueueRootGeneration(canvas, {
      webSearchEnabled,
      seedImagePath: node.gen_inputs?.seed_image ?? node.seed_image ?? null,
      lang: opts.lang ?? 'zh',
      // Regenerate must NOT delete the whole canvas on failure — this is an
      // existing flipbook the user is re-rolling, not a fresh creation. If
      // the re-roll fails the canvas stays (empty root), the user can retry.
      deleteOnFailure: false,
    });
    return { ok: true, deletedHashes: [hash, ...childHashes], parentHash: null };
  }

  // NON-ROOT regenerate: prefer node.gen_inputs (the recorded original
  // click context), fall back to the parent's hotspot record for legacy
  // nodes that pre-date the gen_inputs field.
  let parent;
  try { parent = await readNode(canvas.id, parentHash); } catch (e) {
    return { ok: false, reason: `parent ${parentHash} unreadable: ${e?.message}` };
  }

  const gi = node.gen_inputs ?? null;
  let clickXY;
  let userLabel;
  let seedImagePath;
  if (gi && Array.isArray(gi.click_xy) && gi.click_xy.length === 2) {
    clickXY = [Number(gi.click_xy[0]) || 0, Number(gi.click_xy[1]) || 0];
    userLabel = gi.user_label ?? null;
    seedImagePath = gi.seed_image ?? null;
  } else {
    // Legacy fallback: read from the parent's hotspot pointing at this
    // child. leader_xy ≈ click_xy; label is what the LLM produced (or
    // user typed) at original-generation time.
    const hotspot = (parent.hotspots ?? []).find((h) => h?.next_hash === hash);
    clickXY = Array.isArray(hotspot?.leader_xy)
      ? [Number(hotspot.leader_xy[0]), Number(hotspot.leader_xy[1])]
      : [0.5, 0.5];
    userLabel = hotspot?.label || node.title || null;
    seedImagePath = node.seed_image ?? null;
  }

  const result = await deleteNodeCascade(canvas, hash);

  // Re-read the parent (deleteNodeCascade rewrote it).
  const freshParent = await readNode(canvas.id, parentHash).catch(() => parent);

  enqueueClickExpansion(canvas, {
    parentNode: freshParent,
    clickXY,
    webSearchEnabled,
    seedImagePath,
    userLabel,
    lang: opts.lang ?? 'zh',
  });
  return {
    ok: true,
    deletedHashes: result.deletedHashes,
    parentHash,
  };
}
