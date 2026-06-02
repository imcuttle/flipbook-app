#!/usr/bin/env node
// serve-preview — build a canvas's self-contained static preview and serve it
// over a local HTTP server for quick viewing in a browser.
//
//   node scripts/serve-preview.mjs <canvasId> [--lang en] [--port 8088]
//
// Builds the same static site the "导出预览" feature produces (index.html /
// viewer.js / viewer.css / data.js + images/) into a temp dir, then starts a
// tiny dependency-free static file server rooted at that dir and prints the
// URL. Ctrl-C stops the server and cleans up the temp dir.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { id: null, lang: 'zh', port: 8088 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') out.lang = argv[++i] === 'en' ? 'en' : 'zh';
    else if (a === '--port') out.port = Number(argv[++i]) || 8088;
    else if (!a.startsWith('--') && !out.id) out.id = a;
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) {
    console.error('Usage: node scripts/serve-preview.mjs <canvasId> [--lang en] [--port 8088]');
    process.exit(1);
  }

  const { buildCanvasSite } = await import(path.join(APP_ROOT, 'server', 'src', 'export', 'buildExport.js'));
  const { isSafeId } = await import(path.join(APP_ROOT, 'server', 'src', 'store', 'paths.js'));
  if (!isSafeId(args.id)) { console.error(`Invalid canvasId: ${args.id}`); process.exit(1); }

  const distExportIndex = path.join(APP_ROOT, 'web', 'dist-export', 'index.html');
  if (!fs.existsSync(distExportIndex)) {
    console.error('[err] web/dist-export not found — run `npm run build:export` first.');
    process.exit(1);
  }

  let site;
  try {
    site = await buildCanvasSite(args.id, { lang: args.lang });
  } catch (e) {
    console.error(`Build failed for ${args.id}: ${e?.message}`);
    process.exit(1);
  }

  // Write the static site to a temp dir.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `flipbook-preview-${args.id}-`));
  for (const entry of site.entries) {
    const dest = path.join(dir, entry.name);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8'));
  }
  console.log(`[ok] built "${site.topic}" (${site.nodeCount} pages) → ${dir}`);

  // Tiny static file server rooted at `dir`. Path traversal is blocked by
  // resolving against the root and rejecting anything that escapes it.
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const resolved = path.normalize(path.join(dir, urlPath));
    if (!resolved.startsWith(dir)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(resolved, (err, buf) => {
      if (err) {
        // SPA-ish fallback: unknown path → index.html (deep links use #hash).
        if (urlPath !== '/index.html') {
          fs.readFile(path.join(dir, 'index.html'), (e2, idx) => {
            if (e2) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(idx);
          });
          return;
        }
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(buf);
    });
  });

  const onShutdown = async () => {
    server.close();
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', onShutdown);
  process.on('SIGTERM', onShutdown);

  server.listen(args.port, () => {
    console.log(`[serve] http://127.0.0.1:${args.port}/  (Ctrl-C to stop)`);
  });
  server.on('error', (e) => {
    if (e?.code === 'EADDRINUSE') console.error(`Port ${args.port} in use — pass --port <n>`);
    else console.error(e?.message || e);
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  });
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
