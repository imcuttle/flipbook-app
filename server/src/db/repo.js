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

export async function listCanvasesFromDb({ limit, offset, lastCanvasId } = {}) {
  const { Canvas } = models();
  // Stable order: createdAt DESC, then canvasId DESC as a tiebreak (so two
  // rows with identical createdAt still have a deterministic order across
  // pages — the cursor below uses this as the keyset comparison).
  const order = [['createdAt', 'DESC'], ['canvasId', 'DESC']];

  // Cursor mode: if lastCanvasId is given AND we can find the row, return
  // the next page after that cursor (createdAt, canvasId) keyset. This is
  // immune to insertions during paging — a new canvas that lands at the
  // top doesn't shift the cursor's view of the rest.
  if (typeof lastCanvasId === 'string' && lastCanvasId) {
    const cursor = await Canvas.findOne({ where: { canvasId: lastCanvasId } });
    if (cursor) {
      const rows = await Canvas.findAll({
        where: {
          [Op.or]: [
            { createdAt: { [Op.lt]: cursor.createdAt } },
            {
              createdAt: cursor.createdAt,
              canvasId: { [Op.lt]: cursor.canvasId },
            },
          ],
        },
        order,
        ...(typeof limit === 'number' && limit > 0 ? { limit } : {}),
      });
      return rows.map(rowToDto);
    }
    // Cursor row no longer exists (e.g. server restart after the row was
    // deleted) — fall through to offset-based pagination so the client
    // still gets a sensible response.
  }

  const opts = { order };
  if (typeof limit === 'number' && limit > 0) opts.limit = limit;
  if (typeof offset === 'number' && offset > 0) opts.offset = offset;
  const rows = await Canvas.findAll(opts);
  return rows.map(rowToDto);
}

function rowToDto(r) {
  return {
    canvasId: r.canvasId,
    topic: r.topic,
    slug: r.slug,
    branches: r.branches,
    rootHash: r.rootHash,
    coverImage: r.coverImage,
    nodeCount: r.nodeCount,
    created_at: r.createdAt?.toISOString() ?? null,
    last_run_at: r.lastRunAt?.toISOString() ?? null,
  };
}

export async function countCanvases() {
  const { Canvas } = models();
  return Canvas.count();
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

// --- TextSpans (OCR'd in-image text overlays) ---

export async function recordTextSpans(canvasId, nodeHash, spans) {
  const { TextSpan } = models();
  if (!Array.isArray(spans)) return;
  // Idempotent: clear and rewrite (allows re-OCR'ing in the future).
  await TextSpan.destroy({ where: { canvasId, nodeHash } });
  if (spans.length === 0) return;
  const rows = spans.slice(0, 500).map((s, i) => ({
    canvasId, nodeHash, position: i,
    text: String(s.text ?? '').slice(0, 240),
    x: Number(s.bbox?.[0] ?? 0),
    y: Number(s.bbox?.[1] ?? 0),
    w: Number(s.bbox?.[2] ?? 0),
    h: Number(s.bbox?.[3] ?? 0),
    confidence: typeof s.confidence === 'number' ? s.confidence : null,
    createdAt: new Date(),
  }));
  await TextSpan.bulkCreate(rows);
}

export async function listTextSpansForNode(canvasId, nodeHash) {
  const { TextSpan } = models();
  const rows = await TextSpan.findAll({
    where: { canvasId, nodeHash },
    order: [['position', 'ASC']],
  });
  return rows.map((r) => ({
    text: r.text,
    bbox: [r.x, r.y, r.w, r.h],
    confidence: r.confidence ?? undefined,
  }));
}

// --- Cascade delete: remove all DB rows for a set of node hashes within a
// canvas. Caller is responsible for the filesystem side (node JSONs, image
// files, tree.json patching). Idempotent.
export async function deleteNodesFromDb(canvasId, hashes) {
  if (!Array.isArray(hashes) || hashes.length === 0) return;
  const { Node, Hotspot, Source, TextSpan, Canvas } = models();
  await Node.destroy({ where: { canvasId, hash: { [Op.in]: hashes } } });
  // Drop hotspots that point at deleted children, and hotspots whose
  // PARENT was deleted.
  await Hotspot.destroy({
    where: {
      canvasId,
      [Op.or]: [
        { childHash: { [Op.in]: hashes } },
        { parentHash: { [Op.in]: hashes } },
      ],
    },
  });
  await Source.destroy({ where: { canvasId, nodeHash: { [Op.in]: hashes } } });
  await TextSpan.destroy({ where: { canvasId, nodeHash: { [Op.in]: hashes } } });
  // Refresh canvas's nodeCount + clear cover/root if they pointed at a
  // deleted node.
  const c = await Canvas.findByPk(canvasId);
  if (c) {
    const remaining = await Node.count({ where: { canvasId } });
    const patch = { nodeCount: remaining };
    if (c.rootHash && hashes.includes(c.rootHash)) patch.rootHash = null;
    if (c.coverImage && hashes.some((h) => c.coverImage.includes(`/${h}.`))) {
      patch.coverImage = null;
    }
    await Canvas.update(patch, { where: { canvasId } });
  }
}

// Delete an entire canvas and all its dependent rows from the DB.
// Filesystem cleanup is the caller's responsibility. Idempotent.
export async function deleteCanvasFromDb(canvasId) {
  const { Canvas, Node, Hotspot, Source, TextSpan, ShareLink } = models();
  await Promise.all([
    Node.destroy({ where: { canvasId } }),
    Hotspot.destroy({ where: { canvasId } }),
    Source.destroy({ where: { canvasId } }),
    TextSpan.destroy({ where: { canvasId } }),
    ShareLink.destroy({ where: { canvasId } }),
  ]);
  await Canvas.destroy({ where: { canvasId } });
}
