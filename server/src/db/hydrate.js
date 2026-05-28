// On boot, scan data/canvases/* and upsert any missing rows into DB.
// This keeps DB authoritative for queries while letting users drop folders in
// from another machine (or the static-site skill output) and have them appear.
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../store/paths.js';
import { models } from './index.js';
import { log } from '../lib/log.js';

async function readJsonOrNull(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function imageRelForHash(canvasId, hash) {
  for (const ext of ['png', 'svg']) {
    try {
      await fs.stat(paths.imagePath(canvasId, hash, ext));
      return `images/${hash}.${ext}`;
    } catch {}
  }
  return null;
}

export async function hydrateFromDisk() {
  const { Canvas, Node, Hotspot } = models();
  const root = paths.canvasesRoot();
  let dirs = [];
  try { dirs = await fs.readdir(root); } catch { return { canvases: 0, nodes: 0 }; }

  let cCount = 0;
  let nCount = 0;
  let hCount = 0;

  for (const id of dirs) {
    const manifest = await readJsonOrNull(paths.manifestPath(id));
    if (!manifest?.canvasId && !manifest?.topic) continue; // skip non-canvas dirs

    const tree = await readJsonOrNull(paths.treePath(id));
    const rootHash = tree?.root ?? null;
    const allNodes = tree?.nodes ?? {};
    const nodeCount = Object.keys(allNodes).length;
    const coverImage = rootHash
      ? (await imageRelForHash(id, rootHash))
        ? `/api/canvas/${id}/${await imageRelForHash(id, rootHash)}`
        : null
      : null;

    await Canvas.upsert({
      canvasId: id,
      topic: manifest.topic ?? '',
      slug: manifest.slug ?? '',
      branches: manifest.branches ?? 5,
      rootHash,
      coverImage,
      nodeCount,
      createdAt: new Date(manifest.created_at ?? Date.now()),
      lastRunAt: new Date(manifest.last_run_at ?? manifest.created_at ?? Date.now()),
    });
    cCount++;

    // Index nodes
    for (const hash of Object.keys(allNodes)) {
      const meta = allNodes[hash];
      const nodeJson = await readJsonOrNull(paths.nodePath(id, hash));
      const imageRel = nodeJson?.image ?? (await imageRelForHash(id, hash));
      await Node.upsert({
        canvasId: id,
        hash,
        parentHash: meta.parent ?? null,
        depth: meta.depth ?? 0,
        title: meta.title ?? '',
        imageRel: imageRel ?? null,
        createdAt: new Date(nodeJson?.generated_at ?? manifest.created_at ?? Date.now()),
      });
      nCount++;

      // Index hotspots that point to a generated child
      if (Array.isArray(nodeJson?.hotspots)) {
        for (const h of nodeJson.hotspots) {
          if (!h?.next_hash) continue;
          // Avoid duplicate inserts on rehydrate
          const existing = await Hotspot.findOne({
            where: { canvasId: id, parentHash: hash, childHash: h.next_hash },
          });
          if (existing) continue;
          await Hotspot.create({
            canvasId: id,
            parentHash: hash,
            childHash: h.next_hash,
            label: String(h.label ?? '').slice(0, 200),
            anchorX: Number(h.anchor_xy?.[0] ?? 0),
            anchorY: Number(h.anchor_xy?.[1] ?? 0),
            leaderX: Number(h.leader_xy?.[0] ?? 0),
            leaderY: Number(h.leader_xy?.[1] ?? 0),
            createdAt: new Date(nodeJson?.generated_at ?? Date.now()),
          });
          hCount++;
        }
      }

      // Sources (web search references attached to this node)
      if (Array.isArray(nodeJson?.sources) && nodeJson.sources.length > 0) {
        const { Source } = models();
        const existingCount = await Source.count({ where: { canvasId: id, nodeHash: hash } });
        if (existingCount === 0) {
          await Source.bulkCreate(
            nodeJson.sources.slice(0, 20).map((s, i) => ({
              canvasId: id, nodeHash: hash, position: i,
              title: String(s.title ?? '').slice(0, 400),
              url: String(s.url ?? '').slice(0, 800),
              snippet: s.snippet ? String(s.snippet).slice(0, 800) : null,
              source: s.source ? String(s.source).slice(0, 120) : null,
              createdAt: new Date(nodeJson?.generated_at ?? Date.now()),
            })),
          );
        }
      }
    }
  }
  log.info(`[db] hydrated ${cCount} canvases, ${nCount} nodes, ${hCount} hotspots from disk`);
  return { canvases: cCount, nodes: nCount, hotspots: hCount };
}
