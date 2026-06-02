import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../src/lib/zip.js';

// Point the server's data dir at a temp location BEFORE importing any
// config-dependent module. config.js reads process.env.DATA_DIR once at
// import time, so this must happen first.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-export-'));
process.env.DATA_DIR = TMP;
const { paths } = await import('../src/store/paths.js');
const { buildCanvasExport } = await import('../src/export/buildExport.js');

// buildExport 现在从 web/dist-export 读取 Vite 导出产物（index.html +
// viewer.js + 内联 CSS + favicon 等）。单测不跑真实 Vite 构建：伪造一个最小
// 产物目录（buildCanvasSite 只是把目录下文件原样打包）。
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_EXPORT = path.join(APP_ROOT, 'web', 'dist-export');
const STUB_FILES = {
  'index.html': '<!doctype html><html><head><title>Flipbook</title></head><body><div id="root"></div><script src="./data.js"></script><script type="module" src="./viewer.js"></script></body></html>',
  'viewer.js': '/* stub viewer */',
};
let _createdDistExport = false;
if (!fs.existsSync(path.join(DIST_EXPORT, 'index.html'))) {
  fs.mkdirSync(DIST_EXPORT, { recursive: true });
  _createdDistExport = true;
  for (const [name, content] of Object.entries(STUB_FILES)) {
    fs.writeFileSync(path.join(DIST_EXPORT, name), content);
  }
}

// Parse a ZIP buffer: walk local headers to extract { name -> bytes }. Just
// enough of the format to assert our writer produces a readable archive.
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.notEqual(eocd, -1, 'EOCD not found');
  const total = buf.readUInt16LE(eocd + 10);
  const entries = {};
  let off = 0;
  for (let n = 0; n < total; n++) {
    assert.equal(buf.readUInt32LE(off), 0x04034b50, 'bad local header sig');
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString('utf8', off + 30, off + 30 + nameLen);
    const dataStart = off + 30 + nameLen + extraLen;
    const payload = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload);
    off = dataStart + compSize;
  }
  return { total, entries };
}

function parsePayload(entries) {
  return JSON.parse(entries['data.js'].toString('utf8')
    .replace(/^window\.__FLIPBOOK__ = /, '').replace(/;\s*$/, ''));
}

// 1x1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c636060606000000005000146a37c5e0000000049454e44ae426082', 'hex');

async function seedCanvas(id, tree, nodes) {
  await fsp.mkdir(paths.nodeDir(id), { recursive: true });
  await fsp.mkdir(paths.imageDir(id), { recursive: true });
  await fsp.writeFile(paths.treePath(id), JSON.stringify(tree));
  for (const node of nodes) {
    await fsp.writeFile(paths.nodePath(id, node.hash), JSON.stringify(node));
    if (node.image) {
      await fsp.writeFile(path.join(paths.imageDir(id), path.basename(node.image)), PNG);
    }
  }
}

// ---- buildZip ----

test('buildZip round-trips text and binary entries', () => {
  const text = 'hello 世界 — flipbook export';
  const bin = Buffer.from([0, 1, 2, 3, 255, 254, 0, 42]);
  const zip = buildZip([
    { name: 'index.html', data: text },
    { name: 'images/x.png', data: bin, store: true },
  ]);
  const { total, entries } = readZip(zip);
  assert.equal(total, 2);
  assert.equal(entries['index.html'].toString('utf8'), text);
  assert.deepEqual([...entries['images/x.png']], [...bin]);
});

test('buildZip compresses repetitive data and inflates back', () => {
  const big = 'A'.repeat(5000);
  const zip = buildZip([{ name: 'big.txt', data: big }]);
  assert.ok(zip.length < big.length, 'expected deflate to shrink repetitive data');
  const { entries } = readZip(zip);
  assert.equal(entries['big.txt'].toString('utf8'), big);
});

// ---- buildCanvasExport ----

test('buildCanvasExport bundles a static site for a canvas', async () => {
  const id = 'TestCanvas01';
  const rootHash = 'aaaaaaaaaaaa';
  const childHash = 'bbbbbbbbbbbb';
  await seedCanvas(id, {
    topic: '测试主题', root: rootHash, orientation: 'landscape',
    nodes: {
      [rootHash]: { title: '根节点', depth: 0, parent: null, children: [childHash] },
      [childHash]: { title: '子节点', depth: 1, parent: rootHash, children: [] },
    },
  }, [
    {
      hash: rootHash, depth: 0, parent: null, title: '根节点',
      caption: '**粗体**说明', image: `images/${rootHash}.png`,
      hotspots: [{ label: '去子节点', anchor_xy: [0.3, 0.4], leader_xy: [0.25, 0.5], next_hash: childHash }],
      sources: [{ title: '维基', url: 'https://example.com', snippet: 's', source: 'example.com' }],
      text_layer: [{ text: '标注', bbox: [0.1, 0.1, 0.2, 0.05], confidence: 1 }],
      image_w: 1920, image_h: 1080, path: [{ hash: rootHash, title: '根节点' }],
    },
    {
      hash: childHash, depth: 1, parent: rootHash, title: '子节点',
      caption: '子说明', image: `images/${childHash}.png`, hotspots: [],
      path: [{ hash: rootHash, title: '根节点' }, { hash: childHash, title: '子节点' }],
    },
  ]);

  const { buffer, filename } = await buildCanvasExport(id, { lang: 'zh' });
  assert.match(filename, /\.zip$/);
  const { entries } = readZip(buffer);
  for (const f of ['index.html', 'viewer.js', 'data.js']) {
    assert.ok(entries[f], `missing ${f}`);
  }
  assert.ok(entries[`images/${rootHash}.png`], 'root image missing');
  assert.ok(entries[`images/${childHash}.png`], 'child image missing');

  const payload = parsePayload(entries);
  assert.equal(payload.root, rootHash);
  assert.equal(Object.keys(payload.nodes).length, 2);
  assert.equal(payload.nodes[rootHash].hotspots[0].next_hash, childHash);
  assert.equal(payload.nodes[rootHash].image, `images/${rootHash}.png`);
  assert.equal(payload.nodes[rootHash].text_layer.length, 1);

  const html = entries['index.html'].toString('utf8');
  assert.match(html, /src="\.?\/?data\.js"/);
  assert.match(html, /src="\.?\/?viewer\.js"/);
  // 产物必须来自 web/dist-export（Vite 构建），而非旧的手写 template/。
  // 仅当本测试创建了 stub 目录时才断言其内容（CI 上若已有真实构建则跳过）。
  if (_createdDistExport) {
    assert.equal(entries['viewer.js'].toString('utf8'), '/* stub viewer */');
  }
});

test('buildCanvasExport skips still-generating imageless skeletons', async () => {
  const id = 'GenCanvas01';
  const rootHash = 'cccccccccccc';
  const genHash = 'dddddddddddd';
  await seedCanvas(id, {
    topic: 'g', root: rootHash, orientation: 'landscape',
    nodes: {
      [rootHash]: { title: 'R', depth: 0, parent: null, children: [genHash] },
      [genHash]: { title: '', depth: 1, parent: rootHash, children: [], status: 'generating' },
    },
  }, [
    { hash: rootHash, depth: 0, parent: null, title: 'R', caption: '', hotspots: [], image: null },
    { hash: genHash, depth: 1, parent: rootHash, title: '', caption: '', hotspots: [], status: 'generating' },
  ]);

  const { buffer } = await buildCanvasExport(id, { lang: 'zh' });
  const { entries } = readZip(buffer);
  const payload = parsePayload(entries);
  assert.ok(payload.nodes[rootHash], 'root kept');
  assert.ok(!payload.nodes[genHash], 'generating skeleton dropped');
  assert.ok(!payload.tree.nodes[genHash], 'generating skeleton dropped from tree too');
});

test.after(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
  if (_createdDistExport) await fsp.rm(DIST_EXPORT, { recursive: true, force: true });
});
