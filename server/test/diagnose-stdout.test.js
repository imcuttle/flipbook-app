import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseStdout } from '../src/codebuddyClient.js';

// A normal successful codebuddy envelope: a JSON array whose last element is
// the result carrying a JSON string answer.
function envelope(resultText) {
  return JSON.stringify([
    { type: 'system', subtype: 'init' },
    { type: 'result', result: resultText, usage: { input_tokens: 1200, output_tokens: 300 } },
  ]);
}

test('clean result: not gibberish, not truncated', () => {
  const d = diagnoseStdout(envelope('{"title":"故宫","caption":"...","image_prompt":"..."}'), '', new Error('x'));
  assert.equal(d.topParse, 'ok');
  assert.equal(d.gibberish, false);
  assert.equal(d.truncated, false);
  assert.ok(d.resultLen > 0);
  assert.equal(d.usage, 'in=1200 out=300');
});

test('degenerate gibberish: long whitespace-free alnum run is flagged', () => {
  // Sampling-collapse signature: thousands of chars with no whitespace.
  const junk = 'btxlmhpdT2cZyGTaGbebx2miGbYaNucx'.repeat(80); // ~2560 chars
  // Truncated mid-stream (no closing bracket) like the real failures.
  const d = diagnoseStdout(`[{"type":"result","result":"${junk}`, '', new Error('parse'));
  assert.equal(d.gibberish, true, 'should detect degenerate run');
  assert.equal(d.truncated, true, 'unterminated stream is truncated');
  assert.ok(d.maxRun > 1000);
  assert.ok(d.alnumRatio > 0.9);
});

test('truncation without gibberish: short unterminated output', () => {
  const d = diagnoseStdout('[{"type":"result","result":"hello wor', '', new Error('parse'));
  assert.equal(d.truncated, true);
  assert.equal(d.gibberish, false);
});

test('empty stdout is handled', () => {
  const d = diagnoseStdout('', '', new Error('empty'));
  assert.equal(d.stdoutLen, 0);
  assert.equal(d.gibberish, false);
});
