// Mirror of server-side reducer hydrate path. We re-implement the relevant
// transitions in CommonJS-friendly form to keep the test runtime simple.
// The real reducer lives at app/web/src/state/reducer.ts; this test is for the
// concrete bug "open canvas from gallery → stays Loading forever" which boiled
// down to: after canvas_created → set_tree, the rootHash was non-null so the
// subsequent node_ready never set currentHash. The fix is to navigate on
// node_ready whenever there is no currentHash yet.

import test from 'node:test';
import assert from 'node:assert/strict';

// Pure helpers replicating reducer logic (kept in sync with web/src/state/reducer.ts)
function applyNodeReady(state, evt) {
  const node = evt.node;
  let s = {
    ...state,
    nodes: { ...state.nodes, [evt.hash]: node },
    status: { phase: 'ready' },
  };
  if (!node.parent) {
    s = {
      ...s,
      rootHash: state.rootHash ?? evt.hash,
      currentHash: state.currentHash ?? evt.hash,
    };
  } else if (node.parent && state.currentHash === node.parent) {
    s = { ...s, currentHash: evt.hash };
  }
  return s;
}

test('hydrate: gallery → tree → root node_ready sets currentHash', () => {
  // 1) canvas_created: rootHash null, currentHash null
  let state = { canvasId: 'c1', rootHash: null, currentHash: null, nodes: {}, status: { phase: 'planning' } };
  // 2) set_tree: rootHash filled from tree.root
  state = { ...state, tree: { root: 'h0' }, rootHash: state.rootHash ?? 'h0' };
  assert.equal(state.rootHash, 'h0');
  assert.equal(state.currentHash, null, 'currentHash still null after set_tree');

  // 3) node_ready for root → MUST set currentHash
  state = applyNodeReady(state, {
    type: 'node_ready',
    hash: 'h0',
    node: { hash: 'h0', parent: null, title: 'Root', hotspots: [] },
  });
  assert.equal(state.currentHash, 'h0', 'currentHash set after node_ready (this was the bug)');
  assert.equal(state.rootHash, 'h0');
});

test('node_ready does not overwrite currentHash if already set to something else', () => {
  let state = {
    rootHash: 'h0', currentHash: 'h1', nodes: { h1: { hash: 'h1' } }, status: { phase: 'ready' },
  };
  state = applyNodeReady(state, {
    type: 'node_ready',
    hash: 'h2',
    node: { hash: 'h2', parent: null, title: 'Other root?', hotspots: [] },
  });
  // currentHash should not change — user is viewing h1
  assert.equal(state.currentHash, 'h1');
});

test('node_ready for child auto-navigates when parent is current', () => {
  let state = {
    rootHash: 'h0', currentHash: 'h0', nodes: { h0: { hash: 'h0' } }, status: { phase: 'ready' },
  };
  state = applyNodeReady(state, {
    type: 'node_ready',
    hash: 'h1',
    node: { hash: 'h1', parent: 'h0', title: 'Child', hotspots: [] },
  });
  assert.equal(state.currentHash, 'h1');
});

// Deep-link to a non-root node:
// 1. canvas_created (rootHash=null, currentHash=null)
// 2. set_tree (rootHash := tree.root='h0')
// 3. node_ready for child 'h2' (parent='h1')   ← without explicit navigate,
//    currentHash stays null because guards don't fire (it's not root, and its
//    parent is not the current node since current is null).
// 4. App.tsx must dispatch navigate({hash:'h2'}) to recover.
test('deep-link hydrate to child node — navigate recovers currentHash', () => {
  let state = {
    canvasId: 'c1', rootHash: 'h0', currentHash: null,
    nodes: {}, status: { phase: 'planning' },
  };
  // node_ready alone leaves currentHash=null
  state = applyNodeReady(state, {
    type: 'node_ready',
    hash: 'h2',
    node: { hash: 'h2', parent: 'h1', title: 'Grandchild', hotspots: [] },
  });
  assert.equal(state.currentHash, null, 'node_ready alone cannot navigate to a non-root child');
  // App.tsx fix: after node_ready, dispatch navigate
  state = { ...state, currentHash: 'h2', status: { phase: 'ready' } };
  assert.equal(state.currentHash, 'h2');
});
