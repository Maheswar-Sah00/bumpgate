import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCase, guardrailChecks, runFromStream } from '../src/replay.mjs';

// The recorded Kane CLI streams of bumpgatedemo PR #4 (Actions run 44982436782), re-decided by the real gate code.
test('replay PR #4: the real Kane streams give red before the fix and green after it', () => {
  const { phases } = loadCase();
  assert.equal(phases.length, 2);
  const [gate, reverify] = phases;
  assert.equal(gate.result.verdict, 'red');
  assert.equal(gate.result.action, 'block');
  assert.equal(gate.result.rule.everyBasePassStillPasses, false);
  const red = gate.result.rows.filter((r) => r.decision.light === 'red');
  assert.deepEqual(red.map((r) => r.journey.title), ['Checkout explains what is wrong']);
  assert.equal(red[0].bump.length, 2, 'the disagreement was confirmed with a second run');
  assert.ok(red[0].bump.every((r) => r.failedStep?.heading === 'See the errors'));
  assert.equal(reverify.result.verdict, 'green');
  assert.equal(reverify.result.action, 'merge');
  assert.equal(reverify.result.rule.everyBasePassStillPasses, true);
});

test('replay PR #4: the guardrails accept the real fix and reject the two cheats', () => {
  const { manifest } = loadCase();
  const g = guardrailChecks(manifest);
  assert.equal(g.real, null);
  assert.match(g.editsJourney, /may not touch/);
  assert.match(g.undoesBump, /the bump must stay/);
});

test('runFromStream: a stream with no final status is an error, never a pass', () => {
  assert.equal(runFromStream(['{"type":"stream_start","cli_version":"0.10.7"}']).status, 'error');
});
