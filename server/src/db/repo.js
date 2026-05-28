// Higher-level helpers around the Sequelize models.
// Used by the pipeline (registerNode etc.) and by routes (gallery list).
import { Op } from 'sequelize';
import { models } from './index.js';

export async function upsertCanvasMeta({ canvasId, topic, slug, branches, createdAt, lastRunAt }) {
  const { Canvas } = models();
  return Canvas.upsert({
    canvasId,
    topic,
    slug,
    branches: branches ?? 5,
    rootHash: null,
    coverImage: null,
    nodeCount: 0,
    createdAt: createdAt ?? new Date(),
    lastRunAt: lastRunAt ?? new Date(),
  });
}

export async function touchCanvas(canvasId, patch = {}) {
  const { Canvas } = models();
  await Canvas.update(
    { ...patch, lastRunAt: new Date() },
    { where: { canvasId } },
  );
}

export async function recordNode({ canvasId, hash, parentHash, depth, title, imageRel, createdAt }) {
  const { Node } = models();
  await Node.upsert({
    canvasId,
    hash,
    parentHash: parentHash ?? null,
    depth: depth ?? 0,
    title: title ?? '',
    imageRel: imageRel ?? null,
    createdAt: createdAt ?? new Date(),
  });
}

export async function recordHotspot({ canvasId, parentHash, childHash, label, anchorXY, leaderXY }) {
  const { Hotspot } = models();
  return Hotspot.create({
    canvasId,
    parentHash,
    childHash: childHash ?? null,
    label,
    anchorX: anchorXY[0],
    anchorY: anchorXY[1],
    leaderX: leaderXY[0],
    leaderY: leaderXY[1],
    createdAt: new Date(),
  });
}

export async function findNearbyHotspot({ canvasId, parentHash, x, y, threshold = 0.05 }) {
  const { Hotspot } = models();
  // Bounding-box prefilter for SQL, then exact distance check in JS.
  const candidates = await Hotspot.findAll({
    where: {
      canvasId,
      parentHash,
      childHash: { [Op.ne]: null },
      leaderX: { [Op.between]: [x - threshold, x + threshold] },
      leaderY: { [Op.between]: [y - threshold, y + threshold] },
    },
  });
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dx = c.leaderX - x;
    const dy = c.leaderY - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= threshold && d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

export async function listHotspotsForParent(canvasId, parentHash) {
  const { Hotspot } = models();
  return Hotspot.findAll({ where: { canvasId, parentHash }, order: [['createdAt', 'ASC']] });
}

export async function listCanvasesFromDb() {
  const { Canvas } = models();
  const rows = await Canvas.findAll({ order: [['lastRunAt', 'DESC']] });
  return rows.map((r) => ({
    canvasId: r.canvasId,
    topic: r.topic,
    slug: r.slug,
    branches: r.branches,
    rootHash: r.rootHash,
    coverImage: r.coverImage,
    nodeCount: r.nodeCount,
    created_at: r.createdAt?.toISOString() ?? null,
    last_run_at: r.lastRunAt?.toISOString() ?? null,
  }));
}

export async function bumpNodeCount(canvasId) {
  const { Canvas, Node } = models();
  const n = await Node.count({ where: { canvasId } });
  await Canvas.update({ nodeCount: n }, { where: { canvasId } });
  return n;
}

export async function setCoverIfMissing(canvasId, rootHash, coverImage) {
  const { Canvas } = models();
  const c = await Canvas.findByPk(canvasId);
  if (!c) return;
  const patch = {};
  if (!c.rootHash && rootHash) patch.rootHash = rootHash;
  if (!c.coverImage && coverImage) patch.coverImage = coverImage;
  if (Object.keys(patch).length) await Canvas.update(patch, { where: { canvasId } });
}

// --- Share links ---

export async function createShareLink({ canvasId, token, expiresAt }) {
  const { ShareLink } = models();
  return ShareLink.create({
    token, canvasId,
    createdAt: new Date(),
    expiresAt: expiresAt ?? null,
  });
}

export async function resolveShareLink(token) {
  const { ShareLink } = models();
  const row = await ShareLink.findByPk(token);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return { token: row.token, canvasId: row.canvasId, createdAt: row.createdAt, expiresAt: row.expiresAt };
}

export async function findShareLinkForCanvas(canvasId) {
  const { ShareLink } = models();
  return ShareLink.findOne({ where: { canvasId }, order: [['createdAt', 'DESC']] });
}

// --- Sources (web search results attached to a node) ---

export async function recordSources(canvasId, nodeHash, sources) {
  const { Source } = models();
  if (!Array.isArray(sources) || sources.length === 0) return;
  // Idempotent: clear and rewrite
  await Source.destroy({ where: { canvasId, nodeHash } });
  const rows = sources.slice(0, 20).map((s, i) => ({
    canvasId, nodeHash, position: i,
    title: String(s.title ?? '').slice(0, 400),
    url: String(s.url ?? '').slice(0, 800),
    snippet: s.snippet ? String(s.snippet).slice(0, 800) : null,
    source: s.source ? String(s.source).slice(0, 120) : null,
    createdAt: new Date(),
  }));
  if (rows.length) await Source.bulkCreate(rows);
}

export async function listSourcesForNode(canvasId, nodeHash) {
  const { Source } = models();
  const rows = await Source.findAll({
    where: { canvasId, nodeHash },
    order: [['position', 'ASC']],
  });
  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: r.source,
  }));
}
