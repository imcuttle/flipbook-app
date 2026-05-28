// Port of skill/scripts/register-node.mjs.
// Writes node JSON + patches tree.json (atomic-ish). Idempotent.
import fs from 'node:fs/promises';
import { paths } from './paths.js';
import { readTree, writeTree, writeJsonAtomic } from './treeStore.js';

export async function nodeExists(canvasId, hash) {
  try { await fs.stat(paths.nodePath(canvasId, hash)); return true; } catch { return false; }
}

export async function readNode(canvasId, hash) {
  const raw = await fs.readFile(paths.nodePath(canvasId, hash), 'utf8');
  return JSON.parse(raw);
}

export async function writeNode(canvasId, node) {
  if (!node?.hash) throw new Error('node.hash required');
  await writeJsonAtomic(paths.nodePath(canvasId, node.hash), node);
}

// Equivalent of skill register-node: writes node JSON and patches tree.json.
export async function registerNode(canvasId, node) {
  if (!node?.hash) throw new Error('node.hash required');
  await writeNode(canvasId, node);

  const tree = await readTree(canvasId);
  tree.nodes ??= {};
  if (!tree.nodes[node.hash]) {
    tree.nodes[node.hash] = {
      title: node.title,
      depth: node.depth,
      parent: node.parent,
      children: [],
    };
  } else {
    tree.nodes[node.hash].title = node.title;
  }
  if (node.parent === null && tree.root === null) tree.root = node.hash;
  if (node.parent && tree.nodes[node.parent]) {
    const siblings = tree.nodes[node.parent].children;
    if (!siblings.includes(node.hash)) siblings.push(node.hash);
  }
  await writeTree(canvasId, tree);
  return { hash: node.hash };
}

// After a child is registered, link it on the parent's hotspots[index].next_hash.
export async function linkChild(canvasId, parentHash, hotspotIndex, childHash) {
  const parent = await readNode(canvasId, parentHash);
  if (!Array.isArray(parent.hotspots) || !parent.hotspots[hotspotIndex]) {
    throw new Error(`parent ${parentHash} has no hotspot ${hotspotIndex}`);
  }
  parent.hotspots[hotspotIndex].next_hash = childHash;
  await writeNode(canvasId, parent);
}

export async function countNodes(canvasId) {
  try {
    const dirents = await fs.readdir(paths.nodeDir(canvasId));
    return dirents.filter((f) => f.endsWith('.json')).length;
  } catch { return 0; }
}
