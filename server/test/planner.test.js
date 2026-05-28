import test from 'node:test';
import assert from 'node:assert/strict';
import { stubPlannerOutput, stubClickLabel } from '../src/generation/stubPlanner.js';
import { validatePlannerOutput } from '../src/generation/planner.js';
import { validateClickLabel } from '../src/generation/clickLabel.js';

test('stub planner returns title/caption/image_prompt only (Chinese)', () => {
  const out = stubPlannerOutput({ topic: '咖啡冲煮入门', currentLabel: '' });
  const validated = validatePlannerOutput(out);
  assert.equal(typeof validated.title, 'string');
  assert.match(validated.title, /咖啡|入门/);
  assert.equal(typeof validated.caption, 'string');
  assert.equal(typeof validated.image_prompt, 'string');
  assert.ok(!('hotspots' in validated));
});

test('stub planner returns English for English topic', () => {
  const out = stubPlannerOutput({ topic: 'Lighthouse anatomy', currentLabel: '' });
  assert.match(out.title, /Lighthouse anatomy/);
});

test('stub click label returns valid hotspot fields', () => {
  const out = stubClickLabel({
    click_xy: [0.4, 0.6],
    existing_labels: [],
    parent_title: '咖啡冲煮入门',
  });
  const validated = validateClickLabel(out, { click_xy: [0.4, 0.6] });
  assert.equal(typeof validated.label, 'string');
  assert.equal(validated.anchor_xy.length, 2);
  assert.equal(validated.leader_xy.length, 2);
  // Leader should be near click
  const dx = Math.abs(validated.leader_xy[0] - 0.4);
  const dy = Math.abs(validated.leader_xy[1] - 0.6);
  assert.ok(dx < 0.1 && dy < 0.1, `leader far from click: dx=${dx} dy=${dy}`);
});

test('stub click label avoids stacking with existing labels', () => {
  const existing = [
    { label: 'A', anchor_xy: [0.5, 0.5], leader_xy: [0.5, 0.5] },
  ];
  const out = stubClickLabel({
    click_xy: [0.5, 0.5],
    existing_labels: existing,
    parent_title: 'topic',
  });
  // Anchor must be displaced from existing
  const dx = Math.abs(out.anchor_xy[0] - existing[0].anchor_xy[0]);
  const dy = Math.abs(out.anchor_xy[1] - existing[0].anchor_xy[1]);
  assert.ok(dx >= 0.10 || dy >= 0.10, `anchor too close: dx=${dx} dy=${dy}`);
});
