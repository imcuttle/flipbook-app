#!/usr/bin/env node
// example-doc-publish — publish one or more canvases as static example docs to
// this repo's GitHub Pages.
//
//   node scripts/example-doc-publish.mjs <canvasId> [<canvasId> ...] [--lang en]
//                                        [--no-push] [--dir <publishDir>]
//
// For each canvasId it builds the same self-contained static site the
// "导出预览" feature produces (index.html / viewer.js / viewer.css / data.js +
// images/) and writes it to <publishDir>/<canvasId>/. It then (re)generates a
// Pages landing page at <publishDir>/index.html that routes to every published
// example, and — unless --no-push — commits the publish dir to the `gh-pages`
// branch and pushes it to origin.
//
// The landing page + per-example dirs are accumulated: re-running for a new
// canvasId adds it without dropping the others (the script reads the existing
// gh-pages branch first when pushing, and merges an examples manifest).

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

// --- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const out = { ids: [], lang: 'zh', push: true, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') { out.lang = argv[++i] === 'en' ? 'en' : 'zh'; }
    else if (a === '--no-push') { out.push = false; }
    else if (a === '--dir') { out.dir = argv[++i]; }
    else if (a.startsWith('--')) { /* ignore unknown flag */ }
    else { out.ids.push(a); }
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  // When a caller overrides stdio to 'inherit', execFileSync returns null
  // (output went straight to the terminal) — guard so .trim() doesn't throw.
  return (out == null ? '' : out).trim();
}

function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- landing page ----------------------------------------------------------
// A static gallery that links to /<canvasId>/ for each example. Pure HTML/CSS,
// no build step — matches the flipbook beige aesthetic.
function renderIndex(examples) {
  const cards = examples.map((e) => {
    const cover = e.cover ? `${e.id}/${e.cover}` : null;
    const thumb = cover
      ? `<img class="thumb" src="${htmlEscape(cover)}" alt="" loading="lazy" />`
      : `<div class="thumb thumbEmpty"></div>`;
    return `      <a class="card" href="${htmlEscape(e.id)}/">
        ${thumb}
        <div class="meta">
          <div class="cardTitle">${htmlEscape(e.topic || e.id)}</div>
          <div class="cardSub">${e.nodeCount} ${e.nodeCount === 1 ? 'page' : 'pages'}</div>
        </div>
      </a>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flipbook Canvas — Examples</title>
<style>
  :root { --bg:#F5EFE6; --paper:#fff; --ink:#1F1F1F; --muted:#6F6457; --line:rgba(0,0,0,0.08); }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:'Georgia','Iowan Old Style','Times New Roman',serif; }
  .wrap { max-width:1100px; margin:0 auto; padding:48px 20px 64px; }
  header { text-align:center; margin-bottom:36px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .sub { color:var(--muted); font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:18px; }
  .card { display:flex; flex-direction:column; background:var(--paper); border:1px solid var(--line);
    border-radius:14px; overflow:hidden; text-decoration:none; color:inherit;
    box-shadow:0 2px 10px rgba(0,0,0,0.04); transition:transform 140ms, box-shadow 140ms; }
  .card:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,0.10); }
  .thumb { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; background:var(--bg); }
  .thumbEmpty { display:flex; align-items:center; justify-content:center; color:var(--muted); }
  .meta { padding:12px 14px 14px; }
  .cardTitle { font-size:16px; font-weight:600; line-height:1.35;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .cardSub { color:var(--muted); font-size:12px; margin-top:6px; }
  footer { text-align:center; color:#B4A793; font-size:11px; margin-top:48px; }
  footer a { color:#B4A793; }
  .empty { text-align:center; color:var(--muted); padding:60px 0; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Flipbook Canvas</h1>
      <div class="sub">交互式知识画册 · Examples</div>
    </header>
    ${examples.length
      ? `<div class="grid">\n${cards}\n    </div>`
      : `<div class="empty">No examples published yet.</div>`}
    <footer><a href="https://github.com/imcuttle/flipbook-app" target="_blank" rel="noopener">Copyright Flipbook Canvas</a></footer>
  </div>
</body>
</html>
`;
}

async function writeEntries(targetDir, entries) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  for (const e of entries) {
    const dest = path.join(targetDir, e.name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8'));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ids.length) {
    console.error('Usage: node scripts/example-doc-publish.mjs <canvasId> [<canvasId> ...] [--lang en] [--no-push] [--dir <publishDir>]');
    process.exit(1);
  }

  // Import the site builder from the server package (ESM).
  const { buildCanvasSite } = await import(path.join(APP_ROOT, 'server', 'src', 'export', 'buildExport.js'));
  const { isSafeId } = await import(path.join(APP_ROOT, 'server', 'src', 'store', 'paths.js'));

  const distExportIndex = path.join(APP_ROOT, 'web', 'dist-export', 'index.html');
  if (!fsSync.existsSync(distExportIndex)) {
    console.error('[err] web/dist-export not found — run `npm run build:export` first.');
    process.exit(1);
  }

  // Publish dir: default to a gitignored staging dir under the app.
  const publishDir = path.resolve(args.dir || path.join(APP_ROOT, 'docs-pages'));
  await fs.mkdir(publishDir, { recursive: true });

  // Load the existing examples manifest (so re-publishing accumulates).
  const manifestPath = path.join(publishDir, 'examples.json');
  let examples = [];
  if (fsSync.existsSync(manifestPath)) {
    try { examples = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { examples = []; }
  }
  const byId = new Map(examples.map((e) => [e.id, e]));

  for (const id of args.ids) {
    if (!isSafeId(id)) { console.error(`[skip] invalid canvasId: ${id}`); continue; }
    let site;
    try {
      site = await buildCanvasSite(id, { lang: args.lang });
    } catch (e) {
      console.error(`[fail] ${id}: ${e?.message}`);
      continue;
    }
    await writeEntries(path.join(publishDir, id), site.entries);
    byId.set(id, { id, topic: site.topic, cover: site.cover, nodeCount: site.nodeCount, orientation: site.orientation });
    console.log(`[ok]   ${id} → ${path.join(publishDir, id)}/ (${site.nodeCount} pages)`);
  }

  // Re-derive the manifest (sorted by topic) + regenerate the landing page.
  examples = [...byId.values()].sort((a, b) => String(a.topic).localeCompare(String(b.topic)));
  await fs.writeFile(manifestPath, JSON.stringify(examples, null, 2));
  await fs.writeFile(path.join(publishDir, 'index.html'), renderIndex(examples));
  // Disable Jekyll so directories/files starting with _ are served verbatim.
  await fs.writeFile(path.join(publishDir, '.nojekyll'), '');
  console.log(`[ok]   landing page → ${path.join(publishDir, 'index.html')} (${examples.length} examples)`);

  if (!args.push) {
    console.log('[done] --no-push set; skipping git publish. Serve locally with:');
    console.log(`         npx serve "${publishDir}"`);
    return;
  }

  publishToPages(publishDir, args.ids);
}

// Publish the staging dir to the `gh-pages` branch via a temporary worktree.
// We fetch the existing gh-pages (if any) so previously published examples are
// preserved, then copy the freshly-built examples + regenerated index over it.
function publishToPages(publishDir, ids) {
  const remote = sh('git', ['remote', 'get-url', 'origin'], { cwd: APP_ROOT });
  console.log(`[git]  publishing to gh-pages on ${remote}`);

  const worktree = fsSync.mkdtempSync(path.join(os.tmpdir(), 'flipbook-ghpages-'));
  try {
    // Does the remote already have gh-pages?
    let hasRemoteBranch = false;
    try {
      const ls = sh('git', ['ls-remote', '--heads', 'origin', 'gh-pages'], { cwd: APP_ROOT });
      hasRemoteBranch = !!ls;
    } catch { /* offline / no perms — treat as fresh */ }

    if (hasRemoteBranch) {
      sh('git', ['fetch', 'origin', 'gh-pages', '--depth', '1'], { cwd: APP_ROOT, stdio: 'inherit' });
      sh('git', ['worktree', 'add', '--force', worktree, 'origin/gh-pages'], { cwd: APP_ROOT });
      // Detach + create/reset local gh-pages at fetched head.
      sh('git', ['-C', worktree, 'checkout', '-B', 'gh-pages'], {});
    } else {
      sh('git', ['worktree', 'add', '--force', '--detach', worktree], { cwd: APP_ROOT });
      sh('git', ['-C', worktree, 'checkout', '--orphan', 'gh-pages'], {});
      sh('git', ['-C', worktree, 'rm', '-rf', '.'], {}); // empty the orphan index
    }

    // Copy the freshly built publishDir contents into the worktree. We only
    // overwrite the example dirs we just (re)built + the regenerated landing
    // page/manifest, leaving any other previously published examples intact.
    fsSync.cpSync(path.join(publishDir, 'index.html'), path.join(worktree, 'index.html'));
    fsSync.cpSync(path.join(publishDir, 'examples.json'), path.join(worktree, 'examples.json'));
    fsSync.cpSync(path.join(publishDir, '.nojekyll'), path.join(worktree, '.nojekyll'));
    for (const id of ids) {
      const src = path.join(publishDir, id);
      if (!fsSync.existsSync(src)) continue;
      fsSync.rmSync(path.join(worktree, id), { recursive: true, force: true });
      fsSync.cpSync(src, path.join(worktree, id), { recursive: true });
    }
    // If the remote already had examples we didn't rebuild this run, fold them
    // back into the regenerated landing page by merging manifests.
    mergeRemoteExamples(worktree, publishDir);

    sh('git', ['-C', worktree, 'add', '-A'], {});
    let nothing = false;
    try { sh('git', ['-C', worktree, 'diff', '--cached', '--quiet'], {}); nothing = true; } catch { nothing = false; }
    if (nothing) {
      console.log('[git]  no changes to publish.');
      return;
    }
    sh('git', ['-C', worktree, 'commit', '-m', `publish examples: ${ids.join(', ')}`], {});
    sh('git', ['-C', worktree, 'push', 'origin', 'gh-pages'], { stdio: 'inherit' });
    console.log('[done] pushed to gh-pages. Pages URL (once enabled):');
    const m = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remote);
    if (m) console.log(`         https://${m[1]}.github.io/${m[2]}/`);
  } finally {
    try { sh('git', ['worktree', 'remove', '--force', worktree], { cwd: APP_ROOT }); } catch {}
    try { fsSync.rmSync(worktree, { recursive: true, force: true }); } catch {}
  }
}

// After copying our freshly built examples into the gh-pages worktree, the
// worktree may contain OTHER example dirs from prior publishes that aren't in
// our local manifest. Rebuild the landing page from whatever example dirs
// actually exist on the branch so none are dropped.
function mergeRemoteExamples(worktree, publishDir) {
  const found = [];
  for (const name of fsSync.readdirSync(worktree, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    if (name.name.startsWith('.') || name.name === 'node_modules') continue;
    const dataJs = path.join(worktree, name.name, 'data.js');
    if (!fsSync.existsSync(dataJs)) continue;
    let topic = name.name, cover = null, nodeCount = 0, orientation = 'landscape';
    try {
      const raw = fsSync.readFileSync(dataJs, 'utf8')
        .replace(/^window\.__FLIPBOOK__ = /, '').replace(/;\s*$/, '');
      const payload = JSON.parse(raw);
      topic = payload.topic || name.name;
      orientation = payload.orientation || 'landscape';
      nodeCount = Object.keys(payload.nodes || {}).length;
      const rootNode = payload.nodes && payload.root ? payload.nodes[payload.root] : null;
      cover = rootNode ? rootNode.image : null;
    } catch { /* keep defaults */ }
    found.push({ id: name.name, topic, cover, nodeCount, orientation });
  }
  found.sort((a, b) => String(a.topic).localeCompare(String(b.topic)));
  fsSync.writeFileSync(path.join(worktree, 'examples.json'), JSON.stringify(found, null, 2));
  fsSync.writeFileSync(path.join(worktree, 'index.html'), renderIndex(found));
  // Keep the local staging copy in sync too.
  fsSync.writeFileSync(path.join(publishDir, 'examples.json'), JSON.stringify(found, null, 2));
  fsSync.writeFileSync(path.join(publishDir, 'index.html'), renderIndex(found));
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
