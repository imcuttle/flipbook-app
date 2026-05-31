// Cascade-delete a node and all its descendants from disk + DB.
//
// Source of truth for parent→children relations: the in-canvas tree.json.
// We:
//   1. Walk tree.nodes downward from `hash` to collect every descendant
//      hash (inclusive).
//   2. Delete each node JSON, image file, and DB row in one batch.
//   3. Drop the parent's hotspot entry whose next_hash === this node, plus
//      remove deleted hashes from each tree.nodes[*].children[] list and
//      from tree.nodes itself.
//   4. Bump canvas's last_run_at and broadcast a node_deleted SSE.
//
// Idempotent: re-deleting a missing node is a no-op (returns
// {deletedHashes: []}).
import fs from 'node:fs/promises';
import { paths } from '../store/paths.js';
import { readNode, writeNode } from '../store/nodeStore.js';
import { readTree, writeTree } from '../store/treeStore.js';
import { deleteNodesFromDb } from '../db/repo.js';
import { broadcast } from '../sse/hub.js';
import { SseEvents } from '../sse/events.js';
import { touchLastRun } from '../store/canvasStore.js';
import { cancelHashWork } from './cancelRegistry.js';
import { log } from '../lib/log.js';

// Walk tree.nodes from `start` downward, returning every reachable hash
// (including `start`). Uses a BFS so we get a stable order.
function collectDescendants(treeNodes, start) {
  const out = [];
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const h = queue.shift();
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    const n = treeNodes?.[h];
    if (n?.children) {
      for (const c of n.children) {
        if (!seen.has(c)) queue.push(c);
      }
    }
  }
  return out;
}

async function unlinkIfExists(p) {
  try { await fs.unlink(p); } catch (e) {
    if (e?.code !== 'ENOENT') log.warn(`unlink ${p}: ${e.message}`);
  }
}

export async function deleteNodeCascade(canvas, hash) {
  const tree = await readTree(canvas.id);
  // Already gone? Nothing to do.
  if (!tree.nodes?.[hash]) return { deletedHashes: [], parentHash: null };

  const parentHash = tree.nodes[hash].parent ?? null;
  const deletedHashes = collectDescendants(tree.nodes, hash);

  // 1) Disk: node JSONs and image files (+ progressive variants). Also flag
  //    each hash as cancelled so any in-flight variant/OCR work for it bails
  //    before re-writing the node or broadcasting node_ready.
  for (const h of deletedHashes) {
    cancelHashWork(canvas.id, h);
    await unlinkIfExists(paths.nodePath(canvas.id, h));
    await unlinkIfExists(paths.imagePath(canvas.id, h, 'png'));
    await unlinkIfExists(paths.imagePath(canvas.id, h, 'svg'));
    await unlinkIfExists(paths.imagePath(canvas.id, h, 'blur.jpg'));
    await unlinkIfExists(paths.imagePath(canvas.id, h, 'thumb.jpg'));
    await unlinkIfExists(paths.imagePath(canvas.id, h, 'medium.jpg'));
  }

  // 2) tree.json — drop entries + remove from any children[] lists
  const deleted = new Set(deletedHashes);
  const newNodes = {};
  for (const [h, n] of Object.entries(tree.nodes)) {
    if (deleted.has(h)) continue;
    newNodes[h] = {
      ...n,
      children: (n.children ?? []).filter((c) => !deleted.has(c)),
    };
  }
  tree.nodes = newNodes;
  if (tree.root && deleted.has(tree.root)) tree.root = null;
  await writeTree(canvas.id, tree);

  // 3) Parent node JSON: drop the hotspot whose next_hash === this hash
  //    (only the directly-deleted node's hotspot — descendant hotspots are
  //    moot because their parent JSONs are gone).
  if (parentHash) {
    try {
      const parent = await readNode(canvas.id, parentHash);
      const before = (parent.hotspots ?? []).length;
      parent.hotspots = (parent.hotspots ?? []).filter((h) => h?.next_hash !== hash);
      if (parent.hotspots.length !== before) {
        await writeNode(canvas.id, parent);
      }
    } catch (e) {
      // Parent missing means it was deleted earlier in the cascade — fine.
      log.warn(`deleteNodeCascade: parent ${parentHash} read failed: ${e.message}`);
    }
  }

  // 4) DB cascade
  try {
    await deleteNodesFromDb(canvas.id, deletedHashes);
  } catch (e) {
    log.warn(`deleteNodesFromDb failed: ${e.message}`);
  }

  await touchLastRun(canvas.id);

  // 5) Broadcast — frontend prunes state.nodes / state.tree.nodes and
  //    re-jumps if it was sitting on a deleted node.
  try {
    broadcast(canvas, {
      type: SseEvents.NODE_DELETED,
      canvasId: canvas.id,
      hash,
      deletedHashes,
      parentHash,
    });
  } catch (e) {
    log.warn(`broadcast node_deleted: ${e.message}`);
  }

  return { deletedHashes, parentHash };
}
