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

test('rejects HTML/CSS leaked as a label (the <div style=...> bug)', () => {
  // Regression: the label model occasionally echoes the rendered card's own
  // markup back as the label, which then rendered verbatim in a hotspot
  // card. Such junk must be rejected, not shown.
  const html = `<div style="width:240px;font-family:'PingFang SC',sans-serif;font-size:13px;line`;
  assert.equal(validateClickLabel({ label: html }, CLICK).rejected, true);
  assert.equal(validateClickLabel({ label: 'foo<br>bar' }, CLICK).rejected, true);
  assert.equal(validateClickLabel({ label: 'color: red; font-size: 12px' }, CLICK).rejected, true);
});

test('rejects an absurdly long label', () => {
  const long = '很长的标签'.repeat(20); // 100 chars
  assert.equal(validateClickLabel({ label: long }, CLICK).rejected, true);
});

test('accepts a clean multi-word label with punctuation', () => {
  const out = validateClickLabel({ label: '混凝土基座 (C30)' }, CLICK);
  assert.equal(out.rejected, undefined);
  assert.equal(out.label, '混凝土基座 (C30)');
});

test('rejects when the label names the synthetic red marker', () => {
  // The red crosshair/circle is a software overlay pointing at the click —
  // never part of the scene. If the model named the marker instead of the
  // real subject under it, reject so it never becomes a hotspot label.
  assert.equal(validateClickLabel({ label: '红色准星标记' }, CLICK).rejected, true);
  assert.equal(validateClickLabel({ label: 'red crosshair' }, CLICK).rejected, true);
  assert.equal(validateClickLabel({ label: 'red circle marker' }, CLICK).rejected, true);
  // Also reject when the marker leaks into next_prompt even if label is ok.
  assert.equal(
    validateClickLabel({ label: '屋顶瓦片', next_prompt: 'the red crosshair marker area' }, CLICK).rejected,
    true,
  );
  // A legitimate red object that is NOT the marker should still pass.
  const ok = validateClickLabel({ label: '红色灯笼' }, CLICK);
  assert.equal(ok.rejected, undefined);
  assert.equal(ok.label, '红色灯笼');
});
