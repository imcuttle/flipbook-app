import type { Node, Tree, GalleryEntry } from '../state/types';

const API = '/api';

export async function createCanvas(
  topic: string,
  opts: { webSearch?: boolean; image?: File | Blob | null } = {},
): Promise<{ canvasId: string; jobId: string }> {
  // When the user attaches an image, switch to multipart so the server's
  // /upload variant kicks in and seeds the canvas with the user's picture.
  if (opts.image) {
    const fd = new FormData();
    fd.append('topic', topic);
    if (opts.webSearch === false) fd.append('webSearch', '0');
    fd.append('image', opts.image, 'seed.png');
    const res = await fetch(`${API}/canvas/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`createCanvas (upload) failed: ${res.status}`);
    return res.json();
  }
  const res = await fetch(`${API}/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, webSearch: opts.webSearch }),
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
  opts: { webSearch?: boolean; label?: string | null; image?: File | Blob | null } = {},
): Promise<{ jobId: string; queue: { active: number; pending: number; max: number } }> {
  // Multipart variant when there's a label override or attached image.
  if (opts.image || (opts.label && opts.label.trim())) {
    const fd = new FormData();
    fd.append('parentHash', parentHash);
    fd.append('x', String(x));
    fd.append('y', String(y));
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
    body: JSON.stringify({ parentHash, x, y, webSearch: opts.webSearch }),
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
  signal?: AbortSignal,
): Promise<{ items: GalleryEntry[]; total: number; hasMore: boolean }> {
  const url = `${API}/canvas?limit=${limit}&offset=${offset}`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`listCanvasesPage failed: ${res.status}`);
  return res.json();
}

export async function getNode(canvasId: string, hash: string): Promise<Node> {
  const res = await fetch(`${API}/canvas/${canvasId}/nodes/${hash}`);
  if (!res.ok) throw new Error(`getNode failed: ${res.status}`);
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
