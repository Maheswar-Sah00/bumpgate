import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeZip } from './helpers/zip-write.mjs';
import { openZip } from '../src/zip.mjs';
import { sliceChangelog, inRange, githubSlug } from '../src/notes.mjs';
import { serveStatic, freePort } from '../src/serve.mjs';
import { renderComment, MARKER } from '../src/comment.mjs';
import { decide } from '../src/gate.mjs';
import { parseArgs } from '../src/cli.mjs';
import { readPack } from '../src/evidence.mjs';

test('zip reader + evidence pack reader', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-'));
  const pack = path.join(dir, 'x.evidence');
  writeFileSync(pack, makeZip({
    'run.yaml': 'status: finalized\n',
    'tests/t1/result.yaml': 'status: failed\n',
    'tests/t1/logs/1-console.ndjson': [
      JSON.stringify({ level: 'error', text: 'TypeError: useQuery is not a function' }),
      JSON.stringify({ level: 'log', text: 'hello' }),
    ].join('\n'),
    'tests/t1/logs/1-network.har': JSON.stringify({ log: { entries: [
      { request: { method: 'GET', url: 'http://localhost:4319/api/cart' }, response: { status: 500 } },
      { request: { method: 'GET', url: 'http://localhost:4319/favicon.ico' }, response: { status: 404 } },
      { request: { method: 'GET', url: 'http://localhost:4319/' }, response: { status: 200 } },
    ] } }),
    'tests/t1/steps/0001-a/screenshot.png': 'png1',
    'tests/t1/steps/0002-b/screenshot.png': 'png2',
    'tests/t1/steps/0002-b/annotated.png': 'png2a',
    'tests/t1/steps/0002-b/failure.yaml': 'error: button did nothing\n',
  }));
  const z = openZip(pack);
  assert.equal(z.text('run.yaml'), 'status: finalized\n');
  const p = readPack(pack);
  assert.equal(p.status, 'failed'); // the test's outcome, not the pack's `finalized` state
  assert.deepEqual(p.consoleErrors, ['TypeError: useQuery is not a function']);
  assert.deepEqual(p.networkErrors, [{ status: 500, method: 'GET', url: 'http://localhost:4319/api/cart' }]);
  assert.equal(p.failure.screenshot, 'tests/t1/steps/0002-b/annotated.png');
  assert.match(p.failure.text, /did nothing/);
  assert.equal(p.lastScreenshot, 'tests/t1/steps/0002-b/screenshot.png');
});

test('real Kane 0.10.7 pack shape: jpg shots in ordinal order, totals fallback', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-'));
  const pack = path.join(dir, 'real.evidence');
  const files = {
    'run.yaml': "evidence: '0.1'\nstatus: finalized\ntotals:\n  tests: 1\n  passed: 0\n  failed: 1\n",
    'failure.yaml': 'totals:\n  failures: 1\n',
    'tests/browse-1/logs/0-console.ndjson': [
      JSON.stringify({ marker: 'step', step: '0-1', ordinal: 1 }),
      JSON.stringify({ sequence: 0, level: 'error', text: 'a.defaultQueryOptions is not a function', step: '0-1' }),
    ].join('\n'),
    'tests/browse-1/steps/10-0-10/screenshot.jpg': 'j10',
    'tests/browse-1/steps/9-0-9/failure.yaml': 'step: 0-9\nstatus: failed\n',
  };
  for (let i = 1; i <= 9; i++) files[`tests/browse-1/steps/${i}-0-${i}/screenshot.jpg`] = 'j' + i;
  writeFileSync(pack, makeZip(files));
  const p = readPack(pack);
  assert.equal(p.status, 'failed');
  assert.equal(p.screenshots.length, 10);
  assert.equal(p.lastScreenshot, 'tests/browse-1/steps/10-0-10/screenshot.jpg');
  assert.equal(p.failure.screenshot, 'tests/browse-1/steps/9-0-9/screenshot.jpg');
  assert.deepEqual(p.consoleErrors, ['a.defaultQueryOptions is not a function']);
  const passPack = path.join(dir, 'pass.evidence');
  writeFileSync(passPack, makeZip({ 'run.yaml': 'status: finalized\ntotals:\n  passed: 1\n  failed: 0\n', 'failure.yaml': 'totals:\n  failures: 0\n' }));
  const q = readPack(passPack);
  assert.equal(q.status, 'passed');
  assert.equal(q.failure, null);
});

test('changelog slicing keeps (from, to]', () => {
  const md = '# Changelog\n\n## 5.1.0\n- c\n\n## [5.0.0] - 2024\n- b\n### Breaking\n- object syntax\n\n## 4.36.1\n- a\n';
  const s = sliceChangelog(md, '4.36.1', '5.1.0');
  assert.deepEqual(s.map((x) => x.version), ['5.1.0', '5.0.0']);
  assert.match(s[1].text, /object syntax/);
  assert.equal(inRange('4.36.1', '4.36.1', '5.0.0'), false);
  assert.equal(githubSlug('git+https://github.com/TanStack/query.git'), 'TanStack/query');
  assert.equal(githubSlug('github:colinhacks/zod'), 'colinhacks/zod');
});

test('static server with SPA fallback', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-site-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<h1>shop</h1>');
  writeFileSync(path.join(dir, 'assets', 'a.js'), 'x');
  const port = await freePort();
  const s = await serveStatic(dir, { port });
  try {
    const home = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await home.text(), '<h1>shop</h1>');
    const deep = await fetch(`http://127.0.0.1:${port}/cart/checkout`);
    assert.equal(await deep.text(), '<h1>shop</h1>');
    const js = await fetch(`http://127.0.0.1:${port}/assets/a.js`);
    assert.match(js.headers.get('content-type'), /javascript/);
    const missing = await fetch(`http://127.0.0.1:${port}/assets/nope.js`);
    assert.equal(missing.status, 404);
    // A traversal attempt is normalised back inside the root: it gets the SPA index or a 403/404, never a file outside.
    const escape = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    if (escape.status === 200) assert.equal(await escape.text(), '<h1>shop</h1>');
    else assert.ok([403, 404].includes(escape.status));
  } finally {
    await s.stop();
  }
});

test('static server accepts a relative root', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-rel-'));
  writeFileSync(path.join(dir, 'index.html'), 'rel ok');
  const prev = process.cwd();
  process.chdir(path.dirname(dir));
  const port = await freePort();
  const s = await serveStatic(path.basename(dir), { port });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'rel ok');
  } finally {
    await s.stop();
    process.chdir(prev);
  }
});

test('PR comment renders the table, the rule and the marker', () => {
  const P = { status: 'passed' };
  const r = decide([
    { journey: { title: 'Check out', rel: 'checkout_test.md' }, base: [P], bump: [{ status: 'failed', failedStep: { index: 3, heading: 'Place the order' }, reason: 'nothing happened' }, { status: 'failed' }] },
    { journey: { title: 'Search | filter', rel: 'search_test.md' }, base: [P], bump: [P] },
  ]);
  r.bumps = [{ name: 'zod', from: '3.23.8', to: '4.1.5' }];
  r.base = 'a'.repeat(40);
  r.head = 'b'.repeat(40);
  const md = renderComment(r);
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /Blocked/);
  assert.match(md, /zod 3\.23\.8 → 4\.1\.5/);
  assert.ok(md.includes('🔴 broke at step 3 · 2/2 runs'));
  assert.match(md, /Search \\\| filter/);
  assert.match(md, /❌ 1 broke/);
});

test('arg parsing', () => {
  const a = parseArgs(['check', '--base', 'main', '--fix', '--agent=claude', '--max-runs', '12']);
  assert.deepEqual(a._, ['check']);
  assert.equal(a.base, 'main');
  assert.equal(a.fix, true);
  assert.equal(a.agent, 'claude');
  assert.equal(a.maxRuns, '12');
});

test('action.yml: no unquoted ": " inside a plain scalar (GitHub refuses to load the action)', async () => {
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(new URL('../action.yml', import.meta.url), 'utf8').split(/\r?\n/);
  const bad = lines.filter((l) => {
    const m = l.match(/^\s*[\w-]+:\s+(.*)$/);
    if (!m) return false;
    const v = m[1];
    if (/^["'|>]/.test(v) || v.startsWith('${{')) return false;
    return /:\s/.test(v);
  });
  assert.deepEqual(bad, []);
});

test('release notes: each new major x.0.0 comes first; status mapping', async () => {
  const { majorFirst } = await import('../src/notes.mjs');
  const rel = ['4.6.7', '4.6.6', '4.1.0', '4.0.0', '3.26.0'].map((version) => ({ version }));
  assert.deepEqual(majorFirst(rel).map((r) => r.version), ['4.0.0', '4.6.7', '4.6.6', '4.1.0', '3.26.0']);
  const { statusFor } = await import('../src/github.mjs');
  const result = { rows: [1, 2, 3], rule: { comparable: 3 }, counts: { red: 1 } };
  assert.equal(statusFor('fixed', result, 'merge').state, 'success');
  assert.match(statusFor('fixed', result, 'merge').description, /3\/3/);
  assert.equal(statusFor('red', result, 'block').state, 'failure');
  assert.equal(statusFor('amber', result, 'review').state, 'pending');
  assert.equal(statusFor('inconclusive', result, 'block').state, 'error');
});

test('evidence: a cancelled image/tile load is not a failed request; a failed API call still is', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-net-'));
  const pack = path.join(dir, 'net.evidence');
  writeFileSync(pack, makeZip({
    'run.yaml': 'status: finalized\n',
    'tests/t/logs/0-network.har': JSON.stringify({ log: { entries: [
      { request: { method: 'GET', url: 'https://services.arcgisonline.com/x/MapServer/tile/11/758/972' }, response: { status: 0 } },
      { request: { method: 'GET', url: 'https://tilecache.example/radar/0_0.png' }, response: { status: 0 } },
      { request: { method: 'GET', url: 'https://cdn.example/font.woff2' }, response: { status: 0 }, _resourceType: 'font' },
      { request: { method: 'GET', url: 'https://api.example.com/v1/marine?lat=1' }, response: { status: 0 } },
      { request: { method: 'POST', url: 'http://localhost:4319/api/order' }, response: { status: 500 } },
    ] } }),
  }));
  const p = readPack(pack);
  assert.deepEqual(p.networkErrors.map((n) => n.status + ' ' + n.method + ' ' + n.url.split('?')[0]),
    ['0 GET https://api.example.com/v1/marine', '500 POST http://localhost:4319/api/order']);
});

test('evidence: the main run wins over heal sub-runs for failure and screenshots', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-heal-'));
  const pack = path.join(dir, 'heal.evidence');
  writeFileSync(pack, makeZip({
    'run.yaml': 'status: finalized\n',
    'tests/t/result.yaml': 'status: failed\n',
    'tests/t/steps/1-0-1/screenshot.jpg': 'blank page',
    'tests/t/steps/1-0-1/failure.yaml': 'step: 0-1\nstatus: failed\n',
    'tests/t/steps/2-0-2/screenshot.jpg': 'still blank',
    'tests/t/1/steps/1-0-1/screenshot.jpg': 'kane start page',
    'tests/t/1/steps/2-0-2/failure.yaml': 'step: 0-2\n',
  }));
  const p = readPack(pack);
  assert.equal(p.failure.entry, 'tests/t/steps/1-0-1/failure.yaml');
  assert.equal(p.failure.screenshot, 'tests/t/steps/1-0-1/screenshot.jpg');
  assert.deepEqual(p.screenshots, ['tests/t/steps/1-0-1/screenshot.jpg', 'tests/t/steps/2-0-2/screenshot.jpg']);
});

import { viteOutput, homepageBase } from '../src/config.mjs';

test('viteOutput reads outDir and a GitHub Pages base from the Vite config', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'vite-'));
  writeFileSync(path.join(d, 'vite.config.ts'), [
    'export default defineConfig({',
    "  base: '/voxel-rpg-game/',",
    '  plugins: [react()],',
    "  build: { outDir: 'build' }, // not dist",
    '})',
  ].join('\n'));
  assert.deepEqual(viteOutput(d), { dir: 'build', base: '/voxel-rpg-game/' });
});

test('viteOutput falls back to dist at / and ignores computed values', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'vite-'));
  assert.deepEqual(viteOutput(d), { dir: 'dist', base: '/' });
  writeFileSync(path.join(d, 'vite.config.js'), 'export default { base: process.env.BASE, build: { outDir: `${root}/out` } }');
  assert.deepEqual(viteOutput(d), { dir: 'dist', base: '/' });
});

test('homepageBase turns a CRA homepage into a serve path', () => {
  assert.equal(homepageBase('https://me.github.io/RestaurantPicker'), '/RestaurantPicker/');
  assert.equal(homepageBase('.'), '/');
  assert.equal(homepageBase(undefined), '/');
});

import { configAtBase } from '../src/ci.mjs';
import { execFileSync as execGit } from 'node:child_process';

test('configAtBase reads the base commit, and unset CLI flags do not erase it', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'cfgbase-'));
  const g = (...a) => execGit('git', a, { cwd: d, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(path.join(d, 'bumpgate.config.json'), JSON.stringify({ appDir: 'frontend', agent: 'claude', kane: { timeout: 200 } }));
  g('add', '.'); g('commit', '-qm', 'base');
  const sha = g('rev-parse', 'HEAD');
  writeFileSync(path.join(d, 'bumpgate.config.json'), JSON.stringify({ appDir: 'evil', agent: 'none' })); // working copy differs
  const cfg = configAtBase(d, sha, { agent: undefined, amber: undefined, port: 4362, kane: { maxRuns: 9 } });
  assert.equal(cfg.appDir, 'frontend');
  assert.equal(cfg.agent, 'claude');
  assert.equal(cfg.port, 4362);
  assert.equal(cfg.kane.timeout, 200);
  assert.equal(cfg.kane.maxRuns, 9);
});

import { peerConflictLine } from '../src/workspace.mjs';

test('peerConflictLine names the clash from npm ERESOLVE output', () => {
  const out = 'npm error code ERESOLVE\nnpm error ERESOLVE could not resolve\nnpm error While resolving: react-dom@18.3.1\nnpm error Found: react@19.3.1\n';
  assert.equal(peerConflictLine(out), 'react-dom@18.3.1 conflicts with react@19.3.1');
  assert.equal(peerConflictLine('nothing useful'), 'npm ERESOLVE');
});
