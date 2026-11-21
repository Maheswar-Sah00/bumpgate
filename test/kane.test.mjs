import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStream, classify } from '../src/kane.mjs';

const lines = (events) => events.map((e) => JSON.stringify(e));

test('a passing replay', () => {
  const p = parseStream(lines([
    { type: 'stream_start', cli_version: '0.10.7', surface: 'testmd' },
    { type: 'test_md_step_start', step_index: 1, heading: 'Open the shop' },
    { type: 'step_event', index: 0, event: 'replay_started' },
    { type: 'run_end', status: 'passed', reason: 'ok', credits_consumed: 0 },
    { type: 'test_md_step_end', step_index: 1, status: 'passed', duration_s: 3 },
    { type: 'test_md_summary', overall_status: 'passed', steps: { total: 1, passed: 1, failed: 0, skipped: 0, replay_decisions: 1, author_decisions: 0 }, adaptive_heal: { triggered: false } },
    { type: 'test_md_done', overall_status: 'passed', duration_s: 4, session_id: 's1' },
  ]));
  assert.equal(classify(0, p, false), 'passed');
  assert.equal(p.healTriggered, false);
  assert.equal(p.cliVersion, '0.10.7');
  assert.equal(p.done.session_id, 's1');
});

test('a failing replay names the failed step and Kane bug verdict', () => {
  const p = parseStream([
    'not json noise',
    ...lines([
      { type: 'test_md_step_start', step_index: 1, heading: 'Open the shop' },
      { type: 'test_md_step_end', step_index: 1, status: 'passed' },
      { type: 'test_md_step_start', step_index: 2, heading: 'Place the order' },
      { type: 'run_end', status: 'failed', one_liner: 'Clicking "Place order" did nothing; no confirmation appeared' },
      { type: 'test_md_bug_verdict', step_index: 2, confirmed: true, bug_title: 'Place order button unresponsive', severity: 'high', confidence: 0.9 },
      { type: 'test_md_step_end', step_index: 2, status: 'failed' },
      { type: 'test_md_summary', overall_status: 'failed', steps: { total: 2, passed: 1, failed: 1 }, adaptive_heal: { triggered: true } },
      { type: 'test_md_done', overall_status: 'failed' },
    ]),
  ]);
  assert.equal(classify(1, p, false), 'failed');
  assert.equal(p.failedStep.heading, 'Place the order');
  assert.match(p.failedStep.reason, /did nothing/);
  assert.equal(p.bug.title, 'Place order button unresponsive');
});

test('exit 2 or no steps is an error, not a failure', () => {
  const none = parseStream([]);
  assert.equal(classify(2, none, false), 'error');
  assert.equal(classify(1, none, false), 'error');
  assert.equal(classify(0, none, true), 'error');
});
