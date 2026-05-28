import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './paths.js';

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

// Atomic write: tmp file + rename
async function writeJsonAtomic(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp.' + process.pid + '.' + Date.now();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

export async function readTree(canvasId) {
  return readJson(paths.treePath(canvasId));
}

export async function writeTree(canvasId, tree) {
  return writeJsonAtomic(paths.treePath(canvasId), tree);
}

export async function readPending(canvasId) {
  try { return await readJson(paths.pendingPath(canvasId)); } catch { return []; }
}

export async function writePending(canvasId, pending) {
  return writeJsonAtomic(paths.pendingPath(canvasId), pending);
}

export { writeJsonAtomic };
