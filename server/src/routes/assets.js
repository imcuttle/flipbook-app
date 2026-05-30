import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { paths, isSafeId, isSafeHash } from '../store/paths.js';
import { readNode } from '../store/nodeStore.js';

export const assetsRouter = express.Router();

assetsRouter.get('/:id/nodes/:hash', async (req, res) => {
  const { id, hash } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  if (!isSafeHash(hash)) return res.status(400).json({ error: 'bad_hash' });
  try {
    const node = await readNode(id, hash);
    res.json(node);
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});

assetsRouter.get('/:id/images/:file', (req, res) => {
  const { id, file } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  // file = <hash>.<ext>
  const m = /^([a-f0-9]{12})\.(png|svg)$/.exec(file);
  if (!m) return res.status(400).json({ error: 'bad_file' });
  const [, hash, ext] = m;
  const filePath = paths.imagePath(id, hash, ext);
  // Final path-traversal sanity check: ensure resolved path is inside imageDir
  const dir = paths.imageDir(id);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return res.status(400).json({ error: 'bad_path' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'not_found' });
  if (ext === 'svg') res.type('image/svg+xml');
  else res.type('image/png');
  fs.createReadStream(resolved).pipe(res);
});

// Serve a user-uploaded seed image from the canvas's uploads/ dir. Used by
// the Regenerate info popover to show the seed thumbnail / full view.
// `file` = <basename>.<ext> where basename matches what persistUpload wrote
// (e.g. "seed" or "click-XXXX").
assetsRouter.get('/:id/uploads/:file', (req, res) => {
  const { id, file } = req.params;
  if (!isSafeId(id)) return res.status(400).json({ error: 'bad_id' });
  const m = /^([A-Za-z0-9_-]{1,40})\.(png|jpg|jpeg|webp|gif)$/.exec(file);
  if (!m) return res.status(400).json({ error: 'bad_file' });
  const dir = paths.uploadDir(id);
  const resolved = path.resolve(path.join(dir, file));
  // Path-traversal guard: resolved must stay inside the uploads dir.
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return res.status(400).json({ error: 'bad_path' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'not_found' });
  const ext = m[2].toLowerCase();
  const type = ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
        : 'image/jpeg';
  res.type(type);
  fs.createReadStream(resolved).pipe(res);
});
