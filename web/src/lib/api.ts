import type { Node, Tree, GalleryEntry } from '../state/types';

const API = '/api';

export async function createCanvas(
  topic: string,
  opts: { webSearch?: boolean } = {},
): Promise<{ canvasId: string; jobId: string }> {
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
  opts: { webSearch?: boolean } = {},
): Promise<{ jobId: string; queue: { active: number; pending: number; max: number } }> {
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
