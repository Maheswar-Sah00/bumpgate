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

test('real Kane 0.10.7 stream: diagnosis, reason code, failed authoring is not a recording', async () => {
  const { parseStream, classify, hasRecording } = await import('../src/kane.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const lines = [
    { type: 'stream_start', cli_version: '0.10.7', surface: 'testmd' },
    { type: 'test_md_step_start', step_index: 1, heading: 'Search the shop', ref: null },
    { type: 'run_end', status: 'failed', summary: 'The page crashes while starting.\nFix the startup dependency.\nevidence: console_error: x is not a function',
      one_liner: 'The product search page did not load.', reason: 'The page remains an empty root.', credits_consumed: 15.9, reason_code: 'assertion_error.confirmed_product_bug' },
    { type: 'test_md_bug_verdict', step_index: 1, confirmed: true, bug_title: 'Page crashes during load', severity: 'major', confidence: 0.99, category: 'script_error' },
    { type: 'test_md_step_end', step_index: 1, status: 'failed', duration_s: 43 },
    { type: 'test_md_summary', overall_status: 'failed', steps: { total: 2, passed: 0, failed: 1, skipped: 1, replay_decisions: 0, author_decisions: 2 }, adaptive_heal: { triggered: false }, commit: { committed: false, reason: 'run_failed' } },
    { type: 'test_md_done', overall_status: 'failed', session_id: 's1' },
  ].map((e) => JSON.stringify(e));
  const p = parseStream(lines);
  assert.equal(classify(1, p, false), 'failed');
  assert.match(p.diagnosis, /startup dependency/);
  assert.equal(p.reasonCode, 'assertion_error.confirmed_product_bug');
  assert.equal(p.failedStep.reason, 'The product search page did not load.');
  assert.equal(p.bug.title, 'Page crashes during load');
  assert.equal(Math.round(p.credits), 16);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-rec-'));
  const test = path.join(dir, 'browse_test.md');
  writeFileSync(test, '# x\n');
  mkdirSync(path.join(dir, 'output-browse', '.internal'), { recursive: true });
  const meta = (status) => writeFileSync(path.join(dir, 'output-browse', '.internal', 'meta.json'),
    JSON.stringify({ executions: [{ execution_id: 'e1', run_kind: 'author', status, valid: true }] }));
  meta('failed');
  assert.equal(hasRecording(test), false);
  meta('passed'); // a passed --local run: meta.json only, no tapes
  assert.equal(hasRecording(test), false);
  mkdirSync(path.join(dir, 'output-browse', '.internal', 'steps', '1-3db176ed', 'flows', '0'), { recursive: true });
  writeFileSync(path.join(dir, 'output-browse', '.internal', 'steps', '1-3db176ed', 'flows', '0', 'actions.ndjson'), '{}\n');
  assert.equal(hasRecording(test), true);
});

import { hardLimitS, stripNotices } from '../src/kane.mjs';

test('hardLimitS gives multi-step recordings room; replays stay short', () => {
  const four = '# T\n\n## One\na\n## Two\nb\n## Three\nc\n## Four\nd\n';
  assert.equal(hardLimitS({ timeout: 300 }, four, false), 840); // recording: 240 + 4 x 150
  assert.equal(hardLimitS({ timeout: 300 }, four, true), 480);  // replay: 240 + 4 x 60
  assert.equal(hardLimitS({ timeout: 300 }, '# T\n## One\n', true), 420); // never below the old floor
});

test('stripNotices drops kane-cli update notices from stderr', () => {
  assert.equal(stripNotices('Skill update available: not installed → 0.1.4 — run `kane-cli install skill`\nreal error').trim(), 'real error');
});
