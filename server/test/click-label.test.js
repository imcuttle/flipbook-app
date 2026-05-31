import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClickLabel } from '../src/generation/clickLabel.js';

const CLICK = { click_xy: [0.5, 0.4] };

test('accepts a normal label', () => {
  const out = validateClickLabel({ label: '白色连帽上衣', anchor_xy: [0.6, 0.5] }, CLICK);
  assert.equal(out.rejected, undefined);
  assert.equal(out.label, '白色连帽上衣');
  assert.deepEqual(out.anchor_xy, [0.6, 0.5]);
});

test('honours explicit confident:false rejection', () => {
  const out = validateClickLabel({ confident: false, reason: 'background sky' }, CLICK);
  assert.equal(out.rejected, true);
  assert.match(out.reason, /sky/);
});

test('falls back to alternate label keys (title/name/subject)', () => {
  assert.equal(validateClickLabel({ title: 'A' }, CLICK).label, 'A');
  assert.equal(validateClickLabel({ name: 'B' }, CLICK).label, 'B');
  assert.equal(validateClickLabel({ subject: 'C' }, CLICK).label, 'C');
});

test('missing label is a SOFT rejection, not a thrown error', () => {
  // Regression: previously threw `label missing`, crashing the whole
  // click-expansion job. Now it returns a rejection so the pipeline can
  // clear the pending bubble + toast the user gracefully.
  let out;
  assert.doesNotThrow(() => { out = validateClickLabel({ anchor_xy: [0.1, 0.1] }, CLICK); });
  assert.equal(out.rejected, true);
  assert.ok(out.reason && out.reason.length > 0);
});

test('non-object output still throws (unparseable)', () => {
  assert.throws(() => validateClickLabel(null, CLICK));
  assert.throws(() => validateClickLabel('nope', CLICK));
});
