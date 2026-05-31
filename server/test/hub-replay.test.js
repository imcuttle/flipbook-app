// Unit tests for SSE hub Last-Event-ID replay (server/src/sse/hub.js).
//
// Every broadcast frame carries a monotonic `id:` and is retained in a
// per-canvas ring buffer. A client that briefly disconnects can reconnect
// with a Last-Event-ID and have the frames it missed replayed — without
// re-receiving frames it already saw, and in id order.

import test from 'node:test';
import assert from 'node:assert/strict';

const { attach, broadcast } = await import('../src/sse/hub.js');

// A res-like stub the hub writes to. Records every raw frame string.
function fakeRes() {
  const writes = [];
  return {
    writes,
    setHeader() {},
    flushHeaders() {},
    write(s) { writes.push(s); return true; },
    on() {},
  };
}

function fakeRuntime(id) {
  return { id, sseClients: new Set() };
}

// Extract the `n` field of each event: frame the hub wrote (skips the
// `: connected` / `: ping` comment frames and replayed comment lines).
function eventNs(res) {
  const out = [];
  for (const f of res.writes) {
    const m = /event: [^\n]+\ndata: (.+)/s.exec(f);
    if (!m) continue;
    try { out.push(JSON.parse(m[1]).n); } catch { /* skip */ }
  }
  return out;
}

// Pull the last `id:` an attached client saw — mirrors what the browser's
// EventSource exposes as MessageEvent.lastEventId.
function lastIdSeen(res) {
  const ids = res.writes.join('').match(/id: (\d+)/g) ?? [];
  return ids.length ? ids[ids.length - 1].split(' ')[1] : null;
}

test('replays only the frames missed during a disconnect, in order', () => {
  const rt = fakeRuntime('cReplay1');
  const a = fakeRes();
  attach(rt, a);
  broadcast(rt, { type: 'node_ready', n: 1 });
  broadcast(rt, { type: 'node_ready', n: 2 });
  broadcast(rt, { type: 'node_ready', n: 3 });

  const since = lastIdSeen(a);
  assert.ok(since, 'client should have observed at least one id');

  // Disconnect, then two events happen while gone.
  rt.sseClients.delete(a);
  broadcast(rt, { type: 'node_ready', n: 4 });
  broadcast(rt, { type: 'done', n: 5 });

  // Reconnect with Last-Event-ID → only 4,5 should be replayed.
  const a2 = fakeRes();
  attach(rt, a2, since);
  assert.deepEqual(eventNs(a2), [4, 5], 'replays exactly the missed frames in order');
});

test('no Last-Event-ID → fresh connection gets no backlog', () => {
  const rt = fakeRuntime('cReplay2');
  const a = fakeRes();
  attach(rt, a);
  broadcast(rt, { type: 'node_ready', n: 1 });
  broadcast(rt, { type: 'node_ready', n: 2 });

  // A brand-new client with no lastEventId must not receive history.
  const fresh = fakeRes();
  attach(rt, fresh, null);
  assert.deepEqual(eventNs(fresh), [], 'fresh client receives no replayed backlog');
});

test('Last-Event-ID at the latest id replays nothing', () => {
  const rt = fakeRuntime('cReplay3');
  const a = fakeRes();
  attach(rt, a);
  broadcast(rt, { type: 'node_ready', n: 1 });
  broadcast(rt, { type: 'node_ready', n: 2 });
  const since = lastIdSeen(a);

  // Reconnect immediately, having missed nothing.
  const a2 = fakeRes();
  attach(rt, a2, since);
  assert.deepEqual(eventNs(a2), [], 'caught-up client gets no replay');
});

test('stale Last-Event-ID below the surviving buffer replays only what remains', () => {
  // The ring buffer caps at 100 frames. A client that was gone long enough
  // for its resume point to be evicted should get whatever still survives
  // (the most recent 100), not crash and not silently get nothing.
  const rt = fakeRuntime('cReplay4');
  const a = fakeRes();
  attach(rt, a);
  // Broadcast 150 frames; the first ~50 ids are evicted from the buffer.
  for (let n = 1; n <= 150; n++) broadcast(rt, { type: 'node_ready', n });
  rt.sseClients.delete(a);

  // Reconnect claiming to have only seen id=0 (i.e. effectively nothing).
  const a2 = fakeRes();
  attach(rt, a2, '0');
  const ns = eventNs(a2);
  assert.equal(ns.length, 100, 'replay is capped at the buffer size (100)');
  // The surviving window is the most recent 100 frames: n=51..150.
  assert.equal(ns[0], 51, 'oldest surviving frame is replayed first');
  assert.equal(ns[ns.length - 1], 150, 'newest frame is replayed last');
});

test('replayed backlog is delivered before any live frame after reconnect', () => {
  // Ordering guarantee: attach() replays BEFORE adding the client to
  // sseClients, so a live broadcast right after reconnect lands after the
  // backlog rather than interleaving ahead of it.
  const rt = fakeRuntime('cReplay5');
  const a = fakeRes();
  attach(rt, a);
  broadcast(rt, { type: 'node_ready', n: 1 });
  broadcast(rt, { type: 'node_ready', n: 2 });
  const since = lastIdSeen(a);
  rt.sseClients.delete(a);
  broadcast(rt, { type: 'node_ready', n: 3 }); // missed while gone

  const a2 = fakeRes();
  attach(rt, a2, since);            // replays n=3
  broadcast(rt, { type: 'done', n: 4 }); // live frame after reconnect
  assert.deepEqual(eventNs(a2), [3, 4], 'backlog (3) precedes live frame (4)');
});

test('two independent canvases keep separate replay buffers', () => {
  const rt1 = fakeRuntime('cReplayX');
  const rt2 = fakeRuntime('cReplayY');
  const a1 = fakeRes();
  attach(rt1, a1);
  broadcast(rt1, { type: 'node_ready', n: 11 });
  broadcast(rt2, { type: 'node_ready', n: 22 }); // different canvas
  const since1 = lastIdSeen(a1);
  rt1.sseClients.delete(a1);
  broadcast(rt1, { type: 'node_ready', n: 12 });

  const a1b = fakeRes();
  attach(rt1, a1b, since1);
  // Must only replay rt1's own missed frame (12), never rt2's (22).
  assert.deepEqual(eventNs(a1b), [12], 'replay is scoped to the canvas');
});
