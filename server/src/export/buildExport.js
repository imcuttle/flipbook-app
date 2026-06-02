// Export a whole canvas as a self-contained static site (index.html + viewer
// assets + images + inlined data) bundled into a ZIP, openable from file://
// with no server requests. Mirrors the live read-only preview.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../store/paths.js';
import { readTree } from '../store/treeStore.js';
import { readNode } from '../store/nodeStore.js';
import { buildZip } from '../lib/zip.js';
import { log } from '../lib/log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vite 导出构建产物目录：server/src/export → 仓库根（app）→ web/dist-export。
// 由 `npm run build:export` 生成（IIFE + 相对路径，离线 file:// 可用）。
const DIST_EXPORT_DIR = path.join(__dirname, '..', '..', '..', 'web', 'dist-export');

// 递归收集 dist-export 下的所有文件，返回相对 entry 名（用 / 分隔）。
// IIFE 构建会把 CSS 内联进 viewer.js，并可能产出 favicon.svg 等额外资源，
// 所以这里整目录打包，而非硬编码三个文件。data.js 由本模块运行时生成，
// 不在该目录内（已被注入到 index.html 的 <script> 引用）。
async function collectViteAssets() {
  const entries = [];
  async function walk(absDir, relPrefix) {
    const dirents = await fs.readdir(absDir, { withFileTypes: true });
    for (const d of dirents) {
      const abs = path.join(absDir, d.name);
      const rel = relPrefix ? `${relPrefix}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(abs, rel);
      else entries.push({ name: rel, data: await fs.readFile(abs) });
    }
  }
  await walk(DIST_EXPORT_DIR, '');
  return entries;
}

// Strip the node JSON down to only the fields the static viewer needs, and
// rewrite the image path to a relative in-zip path (images/<hash>.png). We
// keep image_prompt out (only used for the generating placeholder) and any
// server-side bookkeeping fields.
function projectNode(node, images) {
  return {
    hash: node.hash,
    depth: node.depth ?? 0,
    parent: node.parent ?? null,
    title: node.title || '',
    caption: node.caption || '',
    hotspots: (node.hotspots || []).map((h) => ({
      label: h.label || '',
      anchor_xy: h.anchor_xy || null,
      leader_xy: h.leader_xy || null,
      next_hash: h.next_hash || null,
    })),
    sources: (node.sources || []).map((s) => ({
      title: s.title || '', url: s.url || '', snippet: s.snippet || '', source: s.source || '',
    })),
    text_layer: node.text_layer || [],
    image: images.full ? `images/${images.full}` : null,
    // Progressive-loading variants (when generated): the viewer shows the
    // blurred placeholder first, then upgrades to medium/full on load.
    image_blur: images.blur ? `images/${images.blur}` : null,
    image_medium: images.medium ? `images/${images.medium}` : null,
    image_w: node.image_w,
    image_h: node.image_h,
    path: Array.isArray(node.path)
      ? node.path.map((p) => ({ hash: p.hash, title: p.title || '' }))
      : undefined,
  };
}

// A filesystem-safe slug for the download filename.
function slugify(s) {
  return String(s || 'flipbook')
    .replace(/[\/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'flipbook';
}

/**
 * Build the static-site FILES for a canvas (the same set the export zip
 * contains): index.html / viewer.js / viewer.css / data.js + images/. Shared
 * by buildCanvasExport (which zips them) and the example-doc-publish script
 * (which writes them to a GitHub Pages directory).
 *
 * @param {string} canvasId
 * @param {{ lang?: 'zh'|'en', basePath?: string }} [opts]
 *   basePath — optional path prefix recorded in the payload (unused by the
 *   viewer today since all asset refs are relative, but reserved).
 * @returns {Promise<{ entries: {name:string,data:Buffer|string,store?:boolean}[],
 *   topic: string, payload: object, cover: string|null, nodeCount: number,
 *   orientation: 'landscape'|'portrait' }>}
 */
export async function buildCanvasSite(canvasId, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'zh';
  const tree = await readTree(canvasId);
  const nodeHashes = Object.keys(tree.nodes || {});
  if (!nodeHashes.length) throw new Error('empty_canvas');

  const entries = [];
  const exportNodes = {};
  const imageDir = paths.imageDir(canvasId);

  for (const hash of nodeHashes) {
    let node;
    try { node = await readNode(canvasId, hash); }
    catch { continue; } // tree entry without a node file (e.g. cancelled) — skip
    // Skip still-generating skeletons that never produced an image/title.
    if (node.status === 'generating' && !node.image) continue;

    // Bundle the node's image plus its progressive-loading variants (blur /
    // medium) when present, so the viewer can show a blurred placeholder that
    // upgrades to the full picture. The variant filenames follow the app's
    // convention: <hash>.png + <hash>.blur.jpg + <hash>.medium.jpg.
    const images = { full: null, blur: null, medium: null };
    if (node.image) {
      const base = path.basename(node.image); // e.g. "<hash>.png"
      const abs = path.join(imageDir, base);
      if (fsSync.existsSync(abs)) {
        const buf = await fs.readFile(abs);
        images.full = base;
        const store = /\.(png|jpe?g)$/i.test(base);
        entries.push({ name: `images/${base}`, data: buf, store });
      }
      // Variants are only generated for real PNGs (the svg fallback has none).
      if (/\.png$/i.test(base)) {
        for (const variant of ['blur', 'medium']) {
          const vName = `${hash}.${variant}.jpg`;
          const vAbs = path.join(imageDir, vName);
          if (fsSync.existsSync(vAbs)) {
            const vBuf = await fs.readFile(vAbs);
            images[variant] = vName;
            entries.push({ name: `images/${vName}`, data: vBuf, store: true });
          }
        }
      }
    }
    exportNodes[hash] = projectNode(node, images);
  }

  // Drop tree entries that didn't make it into exportNodes so the catalog
  // and breadcrumb never point at missing nodes.
  const treeNodes = {};
  for (const [h, n] of Object.entries(tree.nodes || {})) {
    if (!exportNodes[h]) continue;
    treeNodes[h] = {
      title: n.title || '',
      depth: n.depth ?? 0,
      parent: n.parent ?? null,
      children: (n.children || []).filter((c) => exportNodes[c]),
    };
  }
  // Ensure root is valid/present.
  let rootHash = tree.root && exportNodes[tree.root] ? tree.root : null;
  if (!rootHash) {
    rootHash = Object.keys(exportNodes).find((h) => !treeNodes[h]?.parent) || Object.keys(exportNodes)[0] || null;
  }

  const orientation = tree.orientation === 'portrait' ? 'portrait' : 'landscape';
  const payload = {
    topic: tree.topic || '',
    root: rootHash,
    orientation,
    lang,
    nodes: exportNodes,
    tree: { nodes: treeNodes, root: rootHash },
  };

  // 读取 Vite 导出构建产物（web/dist-export）。需先运行 `npm run build:export`。
  if (!fsSync.existsSync(path.join(DIST_EXPORT_DIR, 'index.html'))) {
    throw new Error('export build missing — run `npm run build:export` first (expected web/dist-export/index.html)');
  }
  const viteAssets = await collectViteAssets();

  const title = tree.topic || 'Flipbook';
  // 标题由 export 应用运行时通过 document.title 设置（跟随当前节点）。
  const dataJs = 'window.__FLIPBOOK__ = ' + JSON.stringify(payload) + ';\n';

  // 先放 Vite 产物（index.html / viewer.js / 内联样式 / favicon 等），
  // 再放运行时生成的 data.js。images/ 条目此前已 push 进 entries。
  for (const a of viteAssets) entries.push(a);
  entries.push({ name: 'data.js', data: dataJs });

  const cover = rootHash && exportNodes[rootHash] ? exportNodes[rootHash].image : null;
  return {
    entries,
    topic: title,
    payload,
    cover,
    orientation,
    nodeCount: Object.keys(exportNodes).length,
  };
}

/**
 * Build the export ZIP for a canvas.
 * @param {string} canvasId
 * @param {{ lang?: 'zh'|'en' }} [opts]
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export async function buildCanvasExport(canvasId, opts = {}) {
  const { entries, topic, nodeCount } = await buildCanvasSite(canvasId, opts);
  const buffer = buildZip(entries);
  const filename = `${slugify(topic)}.zip`;
  log.info(`[export] canvas=${canvasId} nodes=${nodeCount} images=${entries.filter((e) => e.name.startsWith('images/')).length} → ${buffer.length} bytes`);
  return { buffer, filename };
}
