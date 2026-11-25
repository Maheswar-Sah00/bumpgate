import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubEnv } from '../src/sh.mjs';
import { guardrails, assertedTexts } from '../src/fix.mjs';
import { resolveCommands, DEFAULTS } from '../src/config.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('scrubEnv: install/build/serve never see Bumpgate secrets', () => {
  const env = {
    PATH: '/usr/bin', HOME: '/home/runner', CI: 'true', NODE_OPTIONS: '--max-old-space-size=4096',
    LT_USERNAME: 'u', LT_ACCESS_KEY: 'k', GITHUB_TOKEN: 'ghs_x', GH_TOKEN: 'ghp_x', ANTHROPIC_API_KEY: 'sk-ant',
    OPENAI_API_KEY: 'sk', CODEX_API_KEY: 'sk', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't', ACTIONS_RUNTIME_TOKEN: 't',
    NPM_TOKEN: 'n', AWS_SECRET_ACCESS_KEY: 'a', DB_PASSWORD: 'p',
  };
  const out = scrubEnv(env);
  assert.deepEqual(Object.keys(out).sort(), ['CI', 'HOME', 'NODE_OPTIONS', 'PATH']);
});

test('scrubEnv: the fix agent keeps only its own key', () => {
  const out = scrubEnv({ PATH: 'p', ANTHROPIC_API_KEY: 'a', LT_ACCESS_KEY: 'k', GITHUB_TOKEN: 'g' }, ['ANTHROPIC_API_KEY']);
  assert.deepEqual(out, { PATH: 'p', ANTHROPIC_API_KEY: 'a' });
});

const journeys = [{
  rel: 'checkout_errors_test.md',
  text: '# Checkout explains what is wrong\n\n## See the errors\nVerify the message "Please enter your name" is shown.\nVerify the message "Enter a valid email address" is shown.\n',
}];

test('assertedTexts: reads the texts journeys verify', () => {
  assert.deepEqual(assertedTexts(journeys), ['Please enter your name', 'Enter a valid email address']);
});

test('guardrails: a fix that pastes a checked text into the app is rejected', () => {
  const r = guardrails({
    files: ['src/pages/Checkout.jsx'],
    added: ['  <p className="error">Please enter your name</p>'],
    removed: [],
    asserted: assertedTexts(journeys),
  });
  assert.match(r, /hard-code/);
});

test('guardrails: moving an existing checked text is allowed (the real zod fix passes)', () => {
  assert.equal(guardrails({
    files: ['src/pages/Checkout.jsx'],
    added: ['      result.error.issues.forEach((issue) => {'],
    removed: ['      result.error.errors.forEach((issue) => {'],
    asserted: assertedTexts(journeys),
  }), null);
  assert.equal(guardrails({
    files: ['src/schema.js'],
    added: ["  name: z.string().min(1, 'Please enter your name'),"],
    removed: ["  name: z.string().min(1, { message: 'Please enter your name' }),"],
    asserted: assertedTexts(journeys),
  }), null);
});

test('guardrails: a migration bigger than the limit goes to a human', () => {
  const big = Array.from({ length: 300 }, (_, i) => `line ${i}`);
  assert.match(guardrails({ files: ['src/a.js'], added: big, removed: big, maxChangedLines: 400 }), /needs a human/);
});

test('ignoreScripts: installs with --ignore-scripts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bg-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }));
  writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  assert.equal(resolveCommands({ ...DEFAULTS }, dir).install, 'npm ci --no-audit --no-fund');
  assert.equal(resolveCommands({ ...DEFAULTS, ignoreScripts: true }, dir).install, 'npm ci --no-audit --no-fund --ignore-scripts');
});
