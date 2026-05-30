import type { Node, Tree, GalleryEntry } from '../state/types';

const API = '/api';

export async function createCanvas(
  topic: string,
  opts: { webSearch?: boolean; image?: File | Blob | null; lang?: 'zh' | 'en' } = {},
): Promise<{ canvasId: string; jobId: string }> {
  // When the user attaches an image, switch to multipart so the server's
  // /upload variant kicks in and seeds the canvas with the user's picture.
  if (opts.image) {
    const fd = new FormData();
    fd.append('topic', topic);
    fd.append('lang', opts.lang ?? 'zh');
    if (opts.webSearch === false) fd.append('webSearch', '0');
    fd.append('image', opts.image, 'seed.png');
    const res = await fetch(`${API}/canvas/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`createCanvas (upload) failed: ${res.status}`);
    return res.json();
  }
  const res = await fetch(`${API}/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, webSearch: opts.webSearch, lang: opts.lang ?? 'zh' }),
  });
  if (!res.ok) throw new Error(`createCanvas failed: ${res.status}`);
  return res.json();
}

// New: click on image at normalized coordinates
export async function clickAt(
  canvasId: string,
  parentHash: string,
  x: number,
  y: number,
  opts: { webSearch?: boolean; label?: string | null; image?: File | Blob | null; lang?: 'zh' | 'en' } = {},
): Promise<{ jobId: string; queue: { active: number; pending: number; max: number } }> {
  // Multipart variant when there's a label override or attached image.
  if (opts.image || (opts.label && opts.label.trim())) {
    const fd = new FormData();
    fd.append('parentHash', parentHash);
    fd.append('x', String(x));
    fd.append('y', String(y));
    fd.append('lang', opts.lang ?? 'zh');
    if (opts.webSearch === false) fd.append('webSearch', '0');
    if (opts.label && opts.label.trim()) fd.append('label', opts.label.trim());
    if (opts.image) fd.append('image', opts.image, 'click.png');
    const res = await fetch(`${API}/canvas/${canvasId}/click/upload`, { method: 'POST', body: fd });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`click (upload) failed: ${res.status} ${txt}`);
    }
    return res.json();
  }
  const res = await fetch(`${API}/canvas/${canvasId}/click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentHash, x, y, webSearch: opts.webSearch, lang: opts.lang ?? 'zh' }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`click failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function createShareLink(canvasId: string): Promise<{ token: string; canvasId: string; url: string }> {
  const res = await fetch(`${API}/canvas/${canvasId}/share`, { method: 'POST' });
  if (!res.ok) throw new Error(`share create failed: ${res.status}`);
  return res.json();
}

export async function resolveShareLink(token: string): Promise<{ token: string; canvasId: string; topic: string; readOnly: true }> {
  const res = await fetch(`${API}/share/${token}`);
  if (!res.ok) throw new Error(`share resolve failed: ${res.status}`);
  return res.json();
}

export async function listCanvases(): Promise<GalleryEntry[]> {
  const res = await fetch(`${API}/canvas`);
  if (!res.ok) throw new Error(`listCanvases failed: ${res.status}`);
  return res.json();
}

export async function listCanvasesPage(
  limit: number,
  offset: number,
  lastCanvasId?: string | null,
  signal?: AbortSignal,
): Promise<{ items: GalleryEntry[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (lastCanvasId) params.set('lastCanvasId', lastCanvasId);
  const res = await fetch(`${API}/canvas?${params.toString()}`, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`listCanvasesPage failed: ${res.status}`);
  return res.json();
}

export async function getNode(canvasId: string, hash: string): Promise<Node> {
  const res = await fetch(`${API}/canvas/${canvasId}/nodes/${hash}`);
  if (!res.ok) throw new Error(`getNode failed: ${res.status}`);
  return res.json();
}

// Bulk-delete whole canvases (gallery edit-mode multi-select).
export async function deleteCanvases(ids: string[]): Promise<{ deleted: string[] }> {
  const res = await fetch(`${API}/canvas/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`deleteCanvases failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function getTree(canvasId: string): Promise<Tree> {
  const res = await fetch(`${API}/canvas/${canvasId}/tree`);
  if (!res.ok) throw new Error(`getTree failed: ${res.status}`);
  return res.json();
}

export function imageUrl(canvasId: string, imageRel: string): string {
  if (imageRel.startsWith('/api/')) return imageRel;
  if (imageRel.startsWith('http')) return imageRel;
  return `${API}/canvas/${canvasId}/${imageRel.replace(/^\//, '')}`;
}

// Cascade-delete a node and all descendants.
export async function deleteNode(
  canvasId: string,
  hash: string,
): Promise<{ deletedHashes: string[]; parentHash: string | null }> {
  const res = await fetch(`${API}/canvas/${canvasId}/nodes/${hash}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`delete failed: ${res.status} ${txt}`);
  }
  return res.json();
}

// Re-roll the current node — server cascades-delete descendants and
// re-enqueues the build with the same parent + recorded click_xy +
// user_label + seed_image. Caller passes the current webSearch toggle
// state so the new pass uses the user's intent rather than the persisted
// value from the original generation.
export async function regenerateNode(
  canvasId: string,
  hash: string,
  opts: { webSearch?: boolean; lang?: 'zh' | 'en' } = {},
): Promise<{ ok: boolean; deletedHashes: string[]; parentHash: string | null }> {
  const body = { lang: opts.lang ?? 'zh', ...(opts.webSearch === undefined ? {} : { webSearch: opts.webSearch }) };
  const res = await fetch(`${API}/canvas/${canvasId}/nodes/${hash}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`regenerate failed: ${res.status} ${txt}`);
  }
  return res.json();
}

// Cancel a still-generating hotspot (next_hash null). The in-flight
// generation job runs to completion server-side and the orphan gets
// swept on next restart — but the parent's hotspots[] entry is dropped
// immediately, so the user stops seeing the pending bubble.
export async function cancelHotspot(
  canvasId: string,
  parentHash: string,
  hotspotIndex: number,
): Promise<{ ok: boolean; parentHash: string; hotspotIndex: number; deletedHashes: string[]; label: string | null }> {
  const res = await fetch(
    `${API}/canvas/${canvasId}/nodes/${parentHash}/hotspots/${hotspotIndex}/cancel`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`cancel failed: ${res.status} ${txt}`);
  }
  return res.json();
}
