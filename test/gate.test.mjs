import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideJourney, majority, needsConfirmation, newOnBump, normaliseMessage } from '../src/gate.mjs';

const P = { status: 'passed' };
const F = { status: 'failed' };
const E = { status: 'error' };
const row = (name, base, bump) => ({ journey: { name, title: name, rel: `${name}_test.md` }, base, bump });

test('majority', () => {
  assert.equal(majority([]), 'none');
  assert.equal(majority([P]), 'pass');
  assert.equal(majority([F, F, P]), 'fail');
  assert.equal(majority([P, F]), 'flaky');
  assert.equal(majority([E, E]), 'error');
  assert.equal(majority([E, P]), 'pass');
});

test('the rule: base pass + bump pass = green, merge', () => {
  const r = decide([row('cart', [P], [P]), row('search', [P], [P])]);
  assert.equal(r.verdict, 'green');
  assert.equal(r.action, 'merge');
  assert.equal(r.mergeable, true);
  assert.equal(r.rule.everyBasePassStillPasses, true);
});

test('the rule: base pass + bump fail = red, blocked', () => {
  const r = decide([row('cart', [P], [F, F, P]), row('search', [P], [P])]);
  assert.equal(r.verdict, 'red');
  assert.equal(r.action, 'block');
  assert.equal(r.mergeable, false);
  assert.equal(r.rule.everyBasePassStillPasses, false);
  assert.equal(r.counts.red, 1);
});

test('a journey that already fails on base cannot block', () => {
  const r = decide([row('broken-on-main', [F, F], [F]), row('cart', [P], [P])]);
  assert.equal(r.verdict, 'green');
  assert.equal(r.rows[0].decision.kind, 'base-broken');
});

test('nothing comparable fails closed', () => {
  const r = decide([row('a', [F], [P])]);
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.action, 'hold');
  assert.equal(r.mergeable, false);
});

test('Kane error on the bump fails closed (no auto-merge)', () => {
  const r = decide([row('a', [P], [E, E]), row('b', [P], [P])]);
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.mergeable, false);
});

test('self-heal on the bump is amber, needs review by default', () => {
  const r = decide([row('a', [P], [{ status: 'passed', healed: true }])]);
  assert.equal(r.verdict, 'amber');
  assert.equal(r.action, 'review');
  assert.equal(r.mergeable, false);
  const m = decide([row('a', [P], [{ status: 'passed', healed: true }])], { amber: 'merge' });
  assert.equal(m.mergeable, true);
});

test('new console errors only on the bump are amber; same errors are not', () => {
  const base = [{ status: 'passed', consoleErrors: ['Warning: x at http://localhost:4319/assets/index-abc12345.js:1:2'] }];
  const same = [{ status: 'passed', consoleErrors: ['Warning: x at http://localhost:5000/assets/index-ffff9999.js:9:9'] }];
  assert.equal(decideJourney({ base, bump: same }).light, 'green');
  const extra = [{ status: 'passed', consoleErrors: ['TypeError: Cannot read properties of undefined (reading map)'] }];
  const d = decideJourney({ base, bump: extra });
  assert.equal(d.light, 'amber');
  assert.equal(d.newConsole.length, 1);
});

test('flaky on the bump is amber, not red', () => {
  assert.equal(decideJourney({ base: [P], bump: [P, F] }).light, 'amber');
});

test('confirmation reruns only on disagreement', () => {
  assert.equal(needsConfirmation({ base: [P], bump: [P] }), null);
  assert.equal(needsConfirmation({ base: [P], bump: [F] }), 'bump');
  assert.equal(needsConfirmation({ base: [P], bump: [F, F] }), null, '2 of 3 already decided');
  assert.equal(needsConfirmation({ base: [P], bump: [F, P] }), 'bump', 'tie needs a third run');
  assert.equal(needsConfirmation({ base: [P], bump: [F, P, F] }), null);
  assert.equal(needsConfirmation({ base: [P], bump: [E] }), 'bump');
  assert.equal(needsConfirmation({ base: [F], bump: [P] }), 'base');
  assert.equal(needsConfirmation({ base: [F, F], bump: [P] }), null);
});

test('message normalisation ignores ports, hashes, line numbers', () => {
  assert.equal(
    normaliseMessage('Error at http://localhost:4319/assets/index-AbC123xy.js:10:20?v=1'),
    normaliseMessage('Error at http://localhost:9999/assets/index-ZZZ99999.js:1:2'),
  );
  assert.deepEqual(newOnBump(['a'], ['a', 'b', 'b']), ['b']);
});

test('pickFailure prefers confirmed, then severity, then confidence, then latest', async () => {
  const { pickFailure } = await import('../src/gate.mjs');
  const major = { status: 'failed', bug: { title: 'major', severity: 'major', confidence: 0.96 } };
  const minor = { status: 'failed', bug: { title: 'minor', severity: 'minor', confidence: 0.96 } };
  const confirmedMinor = { status: 'failed', bug: { title: 'confirmed', severity: 'minor', confirmed: true, confidence: 0.5 } };
  assert.equal(pickFailure([major, minor]).bug.title, 'major');
  assert.equal(pickFailure([minor, major]).bug.title, 'major');
  assert.equal(pickFailure([major, confirmedMinor]).bug.title, 'confirmed');
  assert.equal(pickFailure([{ status: 'passed' }]), null);
  const a = { status: 'failed', reason: 'a' }; const b = { status: 'failed', reason: 'b' };
  assert.equal(pickFailure([a, b]).reason, 'b');
});
