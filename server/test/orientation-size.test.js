// Unit tests for orientation-driven image sizing.
//   - resolveImageSize maps orientation → "WxH" string.
//   - parseSize parses "WxH" into {width,height}.
//   - buildFallbackSvg honours dynamic width/height (portrait support).

import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveImageSize, parseSize, config } = await import('../src/config.js');
const { buildFallbackSvg } = await import('../src/lib/svgFallback.js');

test('resolveImageSize: portrait → portrait size, everything else → landscape', () => {
  assert.equal(resolveImageSize('portrait'), config.imageSizePortrait);
  assert.equal(resolveImageSize('landscape'), config.imageSize);
  // Legacy / undefined / garbage all fall back to landscape.
  assert.equal(resolveImageSize(undefined), config.imageSize);
  assert.equal(resolveImageSize('weird'), config.imageSize);
});

test('default sizes are landscape 1920x1080 and portrait 1080x1920', () => {
  assert.equal(config.imageSize, '1920x1080');
  assert.equal(config.imageSizePortrait, '1080x1920');
});

test('parseSize parses WxH and tolerates the × separator + garbage', () => {
  assert.deepEqual(parseSize('1920x1080'), { width: 1920, height: 1080 });
  assert.deepEqual(parseSize('1080x1920'), { width: 1080, height: 1920 });
  assert.deepEqual(parseSize('1080×1920'), { width: 1080, height: 1920 });
  // Malformed input falls back to landscape default.
  assert.deepEqual(parseSize('garbage'), { width: 1920, height: 1080 });
  assert.deepEqual(parseSize(undefined), { width: 1920, height: 1080 });
});

test('buildFallbackSvg defaults to a 1920x1080 viewBox', () => {
  const svg = buildFallbackSvg({ title: 'T', hash: 'abc' });
  assert.match(svg, /viewBox="0 0 1920 1080"/);
  // Background rects span the full viewport.
  assert.match(svg, /<rect width="1920" height="1080"/);
});

test('buildFallbackSvg honours portrait width/height', () => {
  const svg = buildFallbackSvg({ title: 'T', hash: 'abc', width: 1080, height: 1920 });
  assert.match(svg, /viewBox="0 0 1080 1920"/);
  assert.match(svg, /<rect width="1080" height="1920"/);
  // The decorative art group is centred + scaled to fit (contain) rather
  // than drawn in raw 1920×1080 coordinates that would overflow.
  assert.match(svg, /<g transform="translate\(\d+,\d+\) scale\(/);
});
