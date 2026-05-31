// Integration test: after an SSE reconnect (browser refresh) while a
// click-driven child is still being generated server-side, resumeIncomplete
// must re-emit `planning_started` (so the client rebuilds its pending
// bubble) WITHOUT starting a duplicate generation.
//
// We point DATA_DIR at a temp dir BEFORE importing any module that reads
// config.dataDir, lay down a minimal on-disk canvas (tree.json + a complete
// parent node carrying a pending hotspot), mark the click in-flight, attach
// a fake SSE client that records broadcast frames, then run resumeIncomplete.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-e2e-'));
process.env.DATA_DIR = tmp;

const { paths } = await import('../src/store/paths.js');
const { resumeIncomplete } = await import('../src/generation/resume.js');
const { markClickInFlight, markClickJobInFlight, clearClickJobInFlight } = await import('../src/generation/pipeline.js');

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
}

// A 1x1 PNG so imageOk() (size > 0) passes for the "complete" parent node.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function buildCanvas(id, { parentHash, childHash, label }) {
  // tree.json: root === parent, parent has child registered (linked).
  writeJson(paths.treePath(id), {
    topic: 'T', topic_slug: 't', root: parentHash, branches: 5, style: 's',
    nodes: {
      [parentHash]: { title: 'Parent', depth: 0, parent: null, children: [childHash] },
      [childHash]: { title: 'Child', depth: 1, parent: parentHash, children: [] },
    },
  });
  // Parent node JSON — complete (has image + generated_at) + the pending
  // hotspot pointing at the (incomplete) child.
  writeJson(paths.nodePath(id, parentHash), {
    hash: parentHash, depth: 0, parent: null, title: 'Parent', caption: 'c',
    image: `images/${parentHash}.png`, image_prompt: 'p',
    generated_at: new Date().toISOString(),
    web_search_used: false,
    hotspots: [{ label, anchor_xy: [0.6, 0.5], leader_xy: [0.61, 0.37], next_hash: childHash }],
    path: [{ hash: parentHash, title: 'Parent' }], style_tag: 'x',
  });
  // Parent image file (non-empty) so nodeIsComplete(parent) === true.
  fs.mkdirSync(path.dirname(paths.imagePath(id, parentHash, 'png')), { recursive: true });
  fs.writeFileSync(paths.imagePath(id, parentHash, 'png'), PNG_1x1);
  // Child node JSON intentionally absent / incomplete → "in progress".
}

function fakeCanvasRuntime(id) {
  const frames = [];
  // sseClients is a Set of res-like objects with a write() the hub calls.
  const res = { write: (s) => frames.push(s) };
  return {
    runtime: { id, topic: 'T', sseClients: new Set([res]), queue: { enqueue: () => {} } },
    frames,
  };
}

function parseEvents(frames) {
  // hub writes "id: N\nevent: TYPE\ndata: JSON\n\n"
  const out = [];
  for (const f of frames) {
    const m = /event: ([^\n]+)\ndata: (.+)/s.exec(f);
    if (m) { try { out.push({ type: m[1], data: JSON.parse(m[2]) }); } catch { /* skip */ } }
  }
  return out;
}

test('resume replays planning_started for an in-flight click (no duplicate enqueue)', async () => {
  const id = 'cInflight01';
  const parentHash = 'aaaaaaaaaaaa';
  const childHash = 'bbbbbbbbbbbb';
  const label = '白色连帽上衣';
  buildCanvas(id, { parentHash, childHash, label });

  // Simulate the original generation job still running after a refresh.
  markClickInFlight(id, parentHash, label, { jobId: 'origJob1', clickXY: [0.61, 0.37] });

  const { runtime, frames } = fakeCanvasRuntime(id);
  let enqueued = 0;
  runtime.queue.enqueue = () => { enqueued++; };

  await resumeIncomplete(runtime);

  const evts = parseEvents(frames);
  const planning = evts.filter((e) => e.type === 'planning_started');
  assert.equal(planning.length, 1, 'should replay exactly one planning_started');
  assert.equal(planning[0].data.jobId, 'origJob1', 'reuses the original jobId');
  assert.equal(planning[0].data.parentHash, parentHash);
  assert.deepEqual(planning[0].data.clickXY, [0.61, 0.37], 'carries the original clickXY');
  // It must NOT start a duplicate generation while the original is in flight.
  assert.equal(enqueued, 0, 'no duplicate generation enqueued for in-flight click');
});

test('resume re-drives an interrupted click when nothing is in-flight', async () => {
  const id = 'cInterrupted01';
  const parentHash = 'cccccccccccc';
  const childHash = 'dddddddddddd';
  const label = '栏杆';
  buildCanvas(id, { parentHash, childHash, label });
  // No markClickInFlight → the original job is considered dead (e.g. server
  // restarted). resume should re-drive (enqueue) to finish the child.

  const { runtime } = fakeCanvasRuntime(id);
  let enqueued = 0;
  runtime.queue.enqueue = () => { enqueued++; };

  const r = await resumeIncomplete(runtime);
  assert.ok(r.resumed >= 1, 'should resume the interrupted child');
});

test('resume replays planning_started for a click still inferring its label', async () => {
  // Regression: refreshing DURING label inference (before any hotspot is
  // appended to the parent) used to lose the black pending bubble forever
  // — there was no persisted trace. Now every click is tracked by jobId
  // from enqueue, so resume can replay planning_started for it.
  const id = 'cLabelPhase01';
  const parentHash = 'eeeeeeeeeeee';
  // Build a canvas with NO pending hotspot — the parent is complete and
  // childless, mimicking the moment right after long-press but before the
  // label came back.
  writeJson(paths.treePath(id), {
    topic: 'T', topic_slug: 't', root: parentHash, branches: 5, style: 's',
    nodes: { [parentHash]: { title: 'Parent', depth: 0, parent: null, children: [] } },
  });
  writeJson(paths.nodePath(id, parentHash), {
    hash: parentHash, depth: 0, parent: null, title: 'Parent', caption: 'c',
    image: `images/${parentHash}.png`, image_prompt: 'p',
    generated_at: new Date().toISOString(), web_search_used: false,
    hotspots: [], path: [{ hash: parentHash, title: 'Parent' }], style_tag: 'x',
  });
  fs.mkdirSync(path.dirname(paths.imagePath(id, parentHash, 'png')), { recursive: true });
  fs.writeFileSync(paths.imagePath(id, parentHash, 'png'), PNG_1x1);

  // Simulate the in-flight click in its label-inference phase.
  markClickJobInFlight(id, 'labelJob1', { parentHash, clickXY: [0.612, 0.372], isResume: false });

  const { runtime, frames } = fakeCanvasRuntime(id);
  try {
    await resumeIncomplete(runtime);
    const evts = parseEvents(frames).filter((e) => e.type === 'planning_started');
    assert.equal(evts.length, 1, 'replays one planning_started for the label-phase click');
    assert.equal(evts[0].data.jobId, 'labelJob1');
    assert.deepEqual(evts[0].data.clickXY, [0.612, 0.372]);
    assert.equal(evts[0].data.parentHash, parentHash);
  } finally {
    clearClickJobInFlight(id, 'labelJob1');
  }
});
