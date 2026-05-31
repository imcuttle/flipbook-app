// e2e for callOnce's transient-failure recovery. The high-frequency
// "could not parse JSON from codebuddy stdout" error is caused by the model
// occasionally collapsing into degenerate gibberish (truncated, unparseable
// stdout). That failure is transient — a fresh sample almost always parses —
// so callOnce retries. These tests inject a fake runner to prove the retry
// recovers without surfacing an error to the caller, and that a genuinely
// persistent failure still throws after exhausting attempts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { callOnce, __setRunCodebuddyForTest } from '../src/codebuddyClient.js';

// A valid codebuddy envelope wrapping a JSON answer string.
function okEnvelope(obj) {
  return {
    stdout: JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'result', result: JSON.stringify(obj) },
    ]),
    stderr: '',
    exitInfo: { code: 0, signal: null },
  };
}

// The real-world failure: truncated stream ending in a long gibberish run.
function gibberishEnvelope() {
  const junk = 'btxlmhpdT2cZyGTaGbebx2miGbYaNucx'.repeat(80);
  return {
    stdout: `[{"type":"result","result":"${junk}`, // unterminated → unparseable
    stderr: '',
    exitInfo: { code: 0, signal: null },
  };
}

test('callOnce recovers when the first attempts return gibberish', async () => {
  let calls = 0;
  __setRunCodebuddyForTest(async () => {
    calls += 1;
    if (calls < 3) return gibberishEnvelope();   // attempts 1 & 2: collapse
    return okEnvelope({ title: '故宫', caption: 'c', image_prompt: 'p' }); // attempt 3: good
  });
  try {
    const { parsed } = await callOnce({ prompt: 'x', tag: 'test' });
    assert.equal(calls, 3, 'should have retried up to the 3rd attempt');
    assert.equal(parsed.title, '故宫');
  } finally {
    __setRunCodebuddyForTest(null);
  }
});

test('callOnce succeeds on the very first clean response (no wasted retries)', async () => {
  let calls = 0;
  __setRunCodebuddyForTest(async () => {
    calls += 1;
    return okEnvelope({ ok: true });
  });
  try {
    const { parsed } = await callOnce({ prompt: 'x', tag: 'test' });
    assert.equal(calls, 1, 'no retry when the first response parses');
    assert.equal(parsed.ok, true);
  } finally {
    __setRunCodebuddyForTest(null);
  }
});

test('callOnce throws PlannerError only after all attempts fail', async () => {
  let calls = 0;
  __setRunCodebuddyForTest(async () => {
    calls += 1;
    return gibberishEnvelope(); // every attempt collapses
  });
  try {
    await assert.rejects(
      callOnce({ prompt: 'x', tag: 'test', maxAttempts: 3 }),
      /planner failed after retries/,
    );
    assert.equal(calls, 3, 'should exhaust all 3 attempts before throwing');
  } finally {
    __setRunCodebuddyForTest(null);
  }
});
