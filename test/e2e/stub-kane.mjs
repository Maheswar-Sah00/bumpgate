#!/usr/bin/env node
// A stand-in for `kane-cli` in the OFFLINE end-to-end test of Bumpgate's orchestration
// (worktrees, builds, serving, stream parsing, the rule, the comment). It is never used for a
// real verdict: real runs call kane-cli. It drives Playwright through scripted versions of the
// demo journeys and prints the same NDJSON event types `kane-cli testmd run --agent` prints,
// plus a sealed-pack-shaped zip with console logs, so every parser path is exercised.
//
//   Needs playwright-core (not a Bumpgate dependency): npm i --no-save playwright-core
//   BUMPGATE_KANE_CLI_BIN=test/e2e/stub-kane.mjs STUB_FLOWS=test/e2e/demo-flows.mjs bumpgate check ...
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeZip } from '../helpers/zip-write.mjs';

const argv = process.argv.slice(2);
const out = (ev) => process.stdout.write(JSON.stringify({ ...ev, ts: new Date().toISOString() }) + '\n');

if (argv[0] === '--version') { console.log('0.10.7 (stub)'); process.exit(0); }
if (argv[0] !== 'testmd' || argv[1] !== 'run') { console.error('stub-kane: only `testmd run` is supported'); process.exit(2); }

const file = argv[2];
const url = argv[argv.indexOf('--override-start-url') + 1];
const stem = path.basename(file).replace(/_test\.md$/, '');
const flows = await import(pathToFileURL(path.resolve(process.env.STUB_FLOWS || 'test/e2e/demo-flows.mjs')).href);
const flow = flows.default[stem];
const { chromium } = await import(process.env.STUB_PLAYWRIGHT || 'playwright-core');

out({ type: 'stream_start', cli_version: '0.10.7-stub', surface: 'testmd' });
const outDir = path.join(path.dirname(file), `output-${stem}`);
// Like Kane 0.10.7: a recording is the step tapes under .internal/steps/, written only by a commit.
const recorded = existsSync(path.join(outDir, '.internal', 'steps'));
const local = argv.includes('--local');
const browser = await chromium.launch({ executablePath: process.env.STUB_CHROME || undefined, headless: true });
const page = await browser.newPage();
const consoleLines = [];
page.on('console', (m) => consoleLines.push({ level: m.type(), text: m.text() }));
page.on('pageerror', (e) => consoleLines.push({ level: 'error', text: `Uncaught ${e.message}` }));

let failedAt = null;
let reason = null;
let shot = null;
const steps = flow ? flow.steps : [];
await page.goto(url);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  out({ type: 'test_md_step_start', step_index: i + 1, heading: s.heading, ref: `${stem}#${i + 1}` });
  out({ type: 'step_event', index: 0, event: recorded ? 'replay_started' : 'authoring' });
  try {
    await s.run(page, { timeout: 6000 });
    out({ type: 'run_end', status: 'passed', run_id: `run-${i}`, one_liner: `${s.heading}: done` });
    out({ type: 'test_md_step_end', step_index: i + 1, status: 'passed', duration_s: 1 });
  } catch (e) {
    failedAt = i + 1;
    reason = `${s.why || 'The expected result did not appear'}.`;
    shot = await page.screenshot().catch(() => null);
    out({ type: 'run_end', status: 'failed', run_id: `run-${i}`, reason: e.message.split('\n')[0], one_liner: reason });
    out({ type: 'test_md_bug_verdict', step_index: i + 1, confirmed: true, bug_title: s.bug || reason, severity: 'high', confidence: 0.8 });
    out({ type: 'test_md_step_end', step_index: i + 1, status: 'failed', duration_s: 6, failed_sub_step_index: 1 });
    for (let j = i + 1; j < steps.length; j++) out({ type: 'test_md_step_end', step_index: j + 1, status: 'skipped' });
    break;
  }
}
const lastShot = await page.screenshot().catch(() => null);
await browser.close();

// Like Kane: every authoring run writes meta.json; only a passing commit (no --local) writes the tapes.
const committed = !recorded && !local && !failedAt;
if (!recorded) {
  mkdirSync(path.join(outDir, '.internal'), { recursive: true });
  writeFileSync(path.join(outDir, '.internal', 'meta.json'), JSON.stringify({ executions: [{ run_kind: 'author', status: failedAt ? 'failed' : 'passed', valid: true }] }));
  if (committed) {
    steps.forEach((st, i) => {
      const d = path.join(outDir, '.internal', 'steps', `${i + 1}-s${i}`, 'flows', '0');
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 'actions.ndjson'), '{}\n');
    });
    writeFileSync(path.join(outDir, 'Result.md'), 'status: passed\n');
  }
}

const status = failedAt ? 'failed' : 'passed';
const id = `exec_${Date.now()}`;
const evDir = path.join(process.cwd(), '.testmuai', 'evidence');
mkdirSync(evDir, { recursive: true });
const files = {
  'run.yaml': `status: finalized\ntitle: ${stem}\n`,
  [`tests/${stem}/result.yaml`]: `status: ${status}\n`,
  [`tests/${stem}/logs/1-console.ndjson`]: consoleLines.map((c) => JSON.stringify(c)).join('\n'),
  [`tests/${stem}/logs/1-network.har`]: JSON.stringify({ log: { entries: [] } }),
};
steps.forEach((s, i) => { if (!failedAt || i + 1 < failedAt) files[`tests/${stem}/steps/${i + 1}-0-${i + 1}/screenshot.jpg`] = lastShot || 'x'; });
if (failedAt) {
  const d = `tests/${stem}/steps/${failedAt}-0-${failedAt}/`;
  files[d + 'screenshot.jpg'] = shot || 'x';
  files[d + 'failure.yaml'] = `step: ${failedAt}\nreason: ${reason}\n`;
}
const pack = path.join(evDir, `${id}.evidence`);
writeFileSync(pack, makeZip(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : String(v)]))));

const passed = steps.length - (failedAt ? steps.length - failedAt + 1 : 0);
out({ type: 'test_md_summary', overall_status: status, duration_s: 5, steps: { total: steps.length, passed, failed: failedAt ? 1 : 0, skipped: failedAt ? steps.length - failedAt : 0, replay_decisions: recorded ? steps.length : 0, author_decisions: recorded ? 0 : steps.length }, adaptive_heal: { triggered: false }, commit: { committed, reason: committed ? 'ok' : local ? 'not_committed' : 'run_failed' } });
out({ type: 'test_md_done', overall_status: status, duration_s: 5, session_id: id });
process.stderr.write(`evidence: view locally with \`kane-cli evidence serve ${pack}\`\n`);
process.exit(failedAt ? 1 : 0);
