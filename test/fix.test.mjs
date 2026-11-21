import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardrails, parsePorcelainZ, changedFiles } from '../src/fix.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('porcelain -z parsing keeps the first path whole (regression: "rc/pages/x")', () => {
  assert.deepEqual(parsePorcelainZ(' M src/pages/Checkout.jsx\0?? .kane/x_test.md\0'), ['src/pages/Checkout.jsx', '.kane/x_test.md']);
  assert.deepEqual(parsePorcelainZ('R  .kane/new_test.md\0.kane/old_test.md\0'), ['.kane/new_test.md', '.kane/old_test.md']);
});

test('changedFiles on a real repo: an edit to the journeys is seen exactly', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bg-git-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  mkdirSync(path.join(dir, '.kane'));
  writeFileSync(path.join(dir, '.kane', 'a_test.md'), '# a\n');
  writeFileSync(path.join(dir, 'app.js'), '1');
  g('add', '-A'); g('commit', '-qm', 'init');
  writeFileSync(path.join(dir, '.kane', 'a_test.md'), '# weaker\n');
  writeFileSync(path.join(dir, 'app.js'), '2');
  const files = changedFiles(dir);
  assert.deepEqual(files.sort(), ['.kane/a_test.md', 'app.js']);
  assert.match(guardrails({ files, bumps: [], headPkg: {}, newPkg: {} }), /\.kane\/a_test\.md/);
  renameSync(path.join(dir, '.kane', 'a_test.md'), path.join(dir, 'moved.md'));
  g('add', '-A');
  assert.match(guardrails({ files: changedFiles(dir), bumps: [], headPkg: {}, newPkg: {} }), /\.kane\/a_test\.md/);
});
import { buildTask, lastAssistantText } from '../src/agent.mjs';

const bumps = [{ name: '@tanstack/react-query', from: '4.36.1', to: '5.59.0', major: true }];
const headPkg = { dependencies: { '@tanstack/react-query': '^5.59.0', react: '^18.3.1' } };

test('guardrails accept a normal source migration', () => {
  assert.equal(guardrails({ files: ['src/Cart.jsx'], bumps, headPkg, newPkg: headPkg }), null);
});

test('guardrails reject editing the journeys (the exam)', () => {
  assert.match(guardrails({ files: ['src/a.js', '.kane/checkout_test.md'], bumps, headPkg, newPkg: headPkg }), /\.kane\/checkout_test\.md/);
  assert.match(guardrails({ files: ['bumpgate.config.json'], bumps, headPkg, newPkg: headPkg }), /bumpgate\.config\.json/);
  assert.match(guardrails({ files: ['.github/workflows/bumpgate.yml'], bumps, headPkg, newPkg: headPkg }), /workflows/);
});

test('guardrails reject undoing the bump', () => {
  const downgraded = { dependencies: { '@tanstack/react-query': '^4.36.1', react: '^18.3.1' } };
  assert.match(guardrails({ files: ['package.json'], bumps, headPkg, newPkg: downgraded }), /must stay/);
  assert.match(
    guardrails({ files: ['package-lock.json'], bumps, headPkg, newPkg: headPkg, headLock: { '@tanstack/react-query': '5.59.0' }, newLock: { '@tanstack/react-query': '4.36.1' } }),
    /installed/,
  );
});

test('guardrails reject no-op attempts and custom protected paths', () => {
  assert.match(guardrails({ files: [], bumps, headPkg, newPkg: headPkg }), /no changes/);
  assert.match(guardrails({ files: ['e2e/checkout.spec.ts'], protect: ['e2e/'], bumps, headPkg, newPkg: headPkg }), /e2e/);
});

test('task file carries Kane evidence, release notes and the rules', () => {
  const task = buildTask({
    bump: bumps[0],
    failures: [{ title: 'Checkout', text: '# Checkout\n\n## Place the order\nClick Place order.', failedStep: { index: 3, heading: 'Place the order' }, reason: 'nothing happened', consoleErrors: ['TypeError: x'], networkErrors: [], shots: {} }],
    notes: [{ name: '@tanstack/react-query', from: '4.36.1', to: '5.59.0', text: '## 5.0.0\n- object syntax only', repo: 'TanStack/query' }],
    journeysDir: '.kane',
    buildCmd: 'npm run build',
    previous: [{ n: 1, rejected: 'it edited .kane/x_test.md' }],
  });
  assert.match(task, /4\.36\.1 → 5\.59\.0/);
  assert.match(task, /Place the order/);
  assert.match(task, /TypeError: x/);
  assert.match(task, /object syntax only/);
  assert.match(task, /Do not edit anything under `\.kane\/`/);
  assert.match(task, /Attempt 1: rejected/);
});

test('agent transcript: last message', () => {
  const claude = [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }), JSON.stringify({ type: 'result', result: 'Migrated useQuery to the v5 object form.' })].join('\n');
  assert.equal(lastAssistantText('claude', claude), 'Migrated useQuery to the v5 object form.');
  const codex = [JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Updated Cart.jsx for v5.' } })].join('\n');
  assert.equal(lastAssistantText('codex', codex), 'Updated Cart.jsx for v5.');
});
