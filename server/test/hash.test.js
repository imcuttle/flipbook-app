import test from 'node:test';
import assert from 'node:assert/strict';
import { hashNode, rootHash } from '../src/lib/hash.js';

test('hashNode is 12 hex chars', () => {
  const h = hashNode('', 'topic', 'a scene');
  assert.match(h, /^[a-f0-9]{12}$/);
});

test('hashNode is deterministic', () => {
  const a = hashNode('parent', 'lab', 'prompt');
  const b = hashNode('parent', 'lab', 'prompt');
  assert.equal(a, b);
});

test('different parents → different hash', () => {
  const a = hashNode('p1', 'same label', 'same prompt');
  const b = hashNode('p2', 'same label', 'same prompt');
  assert.notEqual(a, b);
});

test('different labels → different hash', () => {
  const a = hashNode('p', 'A', 'prompt');
  const b = hashNode('p', 'B', 'prompt');
  assert.notEqual(a, b);
});

test('rootHash uses empty parent', () => {
  assert.equal(rootHash('topic', 'prompt'), hashNode('', 'topic', 'prompt'));
});
