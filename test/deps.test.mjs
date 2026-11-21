import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle, diffPackageJson, lockVersions, summariseBump, isMajor, compareVersions, pnpmLockVersions, isBotAuthor, bumpLabel } from '../src/deps.mjs';

test('Dependabot titles', () => {
  assert.deepEqual(parseTitle('Bump @tanstack/react-query from 4.36.1 to 5.59.0'), [{ name: '@tanstack/react-query', from: '4.36.1', to: '5.59.0' }]);
  assert.deepEqual(parseTitle('chore(deps): bump vite from 5.4.1 to 6.0.0 in /web'), [{ name: 'vite', from: '5.4.1', to: '6.0.0' }]);
  assert.deepEqual(parseTitle('build(deps-dev): Bump eslint from v8.57.0 to v9.0.0'), [{ name: 'eslint', from: '8.57.0', to: '9.0.0' }]);
  assert.deepEqual(parseTitle('Bump the npm_and_yarn group across 1 directory with 3 updates'), []);
});

test('Renovate titles', () => {
  assert.deepEqual(parseTitle('Update dependency @mui/material to v9'), [{ name: '@mui/material', to: '9' }]);
  assert.deepEqual(parseTitle('fix(deps): update dependency next to v16.3.3'), [{ name: 'next', to: '16.3.3' }]);
  assert.equal(parseTitle('Update react monorepo to v19 (major)')[0].monorepo, true);
});

test('package.json diff', () => {
  const d = diffPackageJson({ dependencies: { a: '^1.0.0', b: '^2.0.0' } }, { dependencies: { a: '^2.0.0', b: '^2.0.0', c: '1' } });
  assert.deepEqual(d.map((x) => x.name).sort(), ['a', 'c']);
});

test('lockfile versions (v3) and summary prefers lockfile', () => {
  const lock = (v) => ({ packages: { '': {}, 'node_modules/zod': { version: v }, 'node_modules/zod/node_modules/x': { version: '1' } } });
  assert.deepEqual(lockVersions(lock('3.23.8')), { zod: '3.23.8' });
  const s = summariseBump({
    title: 'Bump zod from 3.23.8 to 4.1.0',
    basePkg: { dependencies: { zod: '^3.23.8' } },
    headPkg: { dependencies: { zod: '^4.1.0' } },
    baseLock: lockVersions(lock('3.23.8')),
    headLock: lockVersions(lock('4.1.5')),
  });
  assert.equal(s.length, 1);
  assert.equal(s[0].from, '3.23.8');
  assert.equal(s[0].to, '4.1.5');
  assert.equal(s[0].major, true);
  assert.equal(bumpLabel(s), 'zod 3.23.8 → 4.1.5');
});

test('semver helpers', () => {
  assert.equal(isMajor('6.30.3', '6.30.6'), false);
  assert.equal(isMajor('7.3.9', '9.0.0'), true);
  assert.equal(isMajor('0.3.0', '0.4.0'), true);
  assert.equal(compareVersions('1.2.3', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('pnpm lock importer versions', () => {
  const text = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      react:\n        specifier: ^18.2.0\n        version: 18.3.1\n      '@mui/material':\n        specifier: ^7.0.0\n        version: 7.3.9(react@18.3.1)\n    devDependencies:\n      vite:\n        specifier: ^5\n        version: 5.4.1\npackages:\n  react@18.3.1:\n    resolution: {}\n`;
  assert.deepEqual(pnpmLockVersions(text), { react: '18.3.1', '@mui/material': '7.3.9', vite: '5.4.1' });
});

test('bot authors', () => {
  assert.equal(isBotAuthor('dependabot[bot]'), true);
  assert.equal(isBotAuthor('renovate[bot]'), true);
  assert.equal(isBotAuthor('octocat'), false);
});
