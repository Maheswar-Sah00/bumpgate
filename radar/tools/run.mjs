// F1 Live Bump Radar, step 2: run the real product on an OPEN bot PR in a public repo, the way a new user would.
//   1. `bumpgate init` on the PR's base: Claude Code drafts journeys from the base code only; Kane keeps those that pass.  (F3)
//   2. Commit the kept journeys on a local branch `radar-main` (never pushed).
//   3. `radar-bump` = radar-main + the bot PR's exact diff.
//   4. `bumpgate check --base radar-main --head radar-bump`: Kane replays every journey on both, the rule decides.
// Nothing is pushed or commented upstream. Outside install scripts stay off.
//   node run.mjs <id> [--stage init|check]      cases come from radar/cases.json
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, rmSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BG = 'B:/Projects/Kane-CLI/bumpgate/bin/bumpgate.mjs';
const ROOT = 'C:/bumpgate-work/radar'; // C: has the room; B: filled up on 22 Nov
{ // disk guard: never start a build with less than 8 GB free
  const free = Number(execFileSync('powershell', ['-NoProfile', '-Command', '(Get-PSDrive C).Free'], { encoding: 'utf8' }).trim());
  if (free < 8 * 2 ** 30) { console.error(`stopping: only ${(free / 2 ** 30).toFixed(1)} GB free on C:`); process.exit(4); }
}
const id = String(process.argv[2] || '').trim();
const stage = (process.argv.find((a, i) => process.argv[i - 1] === '--stage')) || 'all';
const c = JSON.parse(readFileSync(path.join(HERE, 'cases.json'), 'utf8')).find((x) => x.id === id);
if (!c) { console.error(`no case "${id}" in cases.json`); process.exit(2); }

const WORK = path.join(ROOT, id);
const repoDir = path.join(WORK, 'repo');
const mainDir = path.join(WORK, 'main');
const OUT = path.join(HERE, 'results', id);
mkdirSync(OUT, { recursive: true });
const env = { ...process.env, npm_config_ignore_scripts: 'true', BUMPGATE_WORK: path.join(ROOT, '_work'), NO_COLOR: '1' };
const git = (args, cwd = repoDir) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
const runLogged = (args, cwd, logFile) => new Promise((resolve) => {
  const log = createWriteStream(logFile);
  const p = spawn(process.execPath, [BG, ...args], { cwd, env });
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => { log.write(d); process.stdout.write(d); });
  p.on('close', (code) => { log.end(); resolve(code); });
});

// --- repo, PR head and merge base
const pr = gh(['pr', 'view', String(c.pr), '-R', c.repo, '--json', 'headRefOid,baseRefName,title,state,url,commits']);
const isControl = c.kind === 'control';
if (!existsSync(path.join(repoDir, '.git'))) {
  mkdirSync(WORK, { recursive: true });
  git(['clone', '--filter=blob:none', '--no-checkout', '--quiet', `https://github.com/${c.repo}.git`, repoDir], WORK);
  git(['config', 'user.name', 'Bumpgate Radar']);
  git(['config', 'user.email', 'radar@localhost']);
  git(['config', 'core.autocrlf', 'false']); // Kane recordings must keep LF or replays re-author
}
let head, mergeBase;
if (isControl) { // merged and never reverted: the merge commit vs its first parent
  git(['fetch', '--quiet', 'origin', c.bump]);
  head = c.bump; mergeBase = git(['rev-parse', `${c.bump}^1`]);
} else {
  git(['fetch', '--quiet', 'origin', pr.baseRefName, `+refs/pull/${c.pr}/head:refs/radar/pr`]);
  head = git(['rev-parse', 'refs/radar/pr']);
  if (head !== pr.headRefOid) console.log(`note: PR head moved to ${pr.headRefOid.slice(0, 7)}; using fetched ${head.slice(0, 7)}`);
  mergeBase = git(['merge-base', `origin/${pr.baseRefName}`, head]);
}
const appDir = c.dir && c.dir !== '/' ? c.dir.replace(/^\//, '') : '';
console.log(`${c.repo} #${c.pr}: ${pr.title}\n  base ${mergeBase.slice(0, 7)} · head ${head.slice(0, 7)} · app dir /${appDir}`);
const meta = { ...c, title: pr.title, url: pr.url, state: pr.state, head, mergeBase, appDir, startedAt: new Date().toISOString() };

// --- 1. init on base (F3)
const P = Number(process.env.RADAR_PORT || 4361); // init and check share port P (recordings hold that URL); set RADAR_PORT to run two cases at once
const reuse = process.argv.includes('--reuse-drafts'); // re-record the journeys Claude already drafted (no new drafting)
if (stage === 'all' || stage === 'init') {
  let initArgs = ['init', '--agent', 'claude', '--count', String(c.count || 3), '--port', String(P)];
  const dd = path.join(mainDir, '.kane', '_drafts');
  if (reuse && existsSync(dd)) {
    for (const n of readdirSync(dd)) cpSync(path.join(dd, n), path.join(mainDir, '.kane', n.replace(/\.draft\.md$/, '_test.md')));
    rmSync(dd, { recursive: true, force: true });
    initArgs = ['init', '--skip-agent', '--all', '--port', String(P)];
    console.log('reusing the drafted journeys: ' + readdirSync(path.join(mainDir, '.kane')).filter((n) => n.endsWith('_test.md')).join(', '));
  } else {
    if (existsSync(mainDir)) { try { git(['worktree', 'remove', '--force', mainDir]); } catch { rmSync(mainDir, { recursive: true, force: true }); } }
    git(['worktree', 'prune']);
    git(['worktree', 'add', '-B', 'radar-main', '--force', mainDir, mergeBase]);
  }
  const cfg = { appDir, port: P, agent: 'claude', ...(c.config || {}) };
  writeFileSync(path.join(mainDir, 'bumpgate.config.json'), JSON.stringify(cfg, null, 2) + '\n');
  const t0 = Date.now();
  const code = await runLogged(initArgs, mainDir, path.join(OUT, reuse ? 'init-rerecord.log' : 'init.log'));
  meta.init = { code, seconds: Math.round((Date.now() - t0) / 1000) };
  const kane = path.join(mainDir, '.kane');
  const kept = existsSync(kane) ? readdirSync(kane).filter((n) => n.endsWith('_test.md')) : [];
  const drafts = existsSync(path.join(kane, '_drafts')) ? readdirSync(path.join(kane, '_drafts')) : [];
  meta.init.kept = kept; meta.init.dropped = drafts;
  // keep the journey texts (not the recordings: Kane packs carry the account email)
  mkdirSync(path.join(OUT, 'journeys'), { recursive: true });
  for (const k of kept) cpSync(path.join(kane, k), path.join(OUT, 'journeys', k));
  for (const d of drafts) cpSync(path.join(kane, '_drafts', d), path.join(OUT, 'journeys', d));
  writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`\ninit: exit ${code}, kept ${kept.length} (${kept.join(', ')}), parked ${drafts.length}`);
  if (!kept.length) process.exit(1);
  // 2. commit the journeys on radar-main (local only)
  rmSync(path.join(kane, '_drafts'), { recursive: true, force: true });
  git(['add', '-f', '.kane', 'bumpgate.config.json'], mainDir);
  git(['commit', '--quiet', '-m', 'Add Bumpgate journeys (bumpgate init)'], mainDir);
  // 3. radar-bump = radar-main + the PR's exact diff
  const diff = execFileSync('git', ['diff', '--binary', mergeBase, head], { cwd: repoDir, maxBuffer: 64 << 20 });
  writeFileSync(path.join(WORK, 'pr.diff'), diff);
  git(['branch', '-f', 'radar-bump', 'radar-main']);
  const bumpDir = path.join(WORK, 'bumpwt');
  if (existsSync(bumpDir)) { try { git(['worktree', 'remove', '--force', bumpDir]); } catch { rmSync(bumpDir, { recursive: true, force: true }); } }
  git(['worktree', 'prune']);
  git(['worktree', 'add', '--force', bumpDir, 'radar-bump']);
  git(['apply', '--index', path.join(WORK, 'pr.diff')], bumpDir);
  git(['commit', '--quiet', '-m', pr.title], bumpDir);
  git(['worktree', 'remove', '--force', bumpDir]);
}

// --- 4. the gate
if (stage === 'all' || stage === 'check') {
  const out = path.join(WORK, 'out');
  rmSync(out, { recursive: true, force: true });
  const t0 = Date.now();
  const code = await runLogged(['check', '--repo', repoDir, '--base', 'radar-main', '--head', 'radar-bump', '--title', pr.title, '--port', String(P), '--out', out], mainDir, path.join(OUT, 'check.log'));
  const m = existsSync(path.join(OUT, 'meta.json')) ? JSON.parse(readFileSync(path.join(OUT, 'meta.json'), 'utf8')) : meta;
  m.check = { code, seconds: Math.round((Date.now() - t0) / 1000) };
  for (const f of ['verdict.json', 'comment.md']) if (existsSync(path.join(out, f))) cpSync(path.join(out, f), path.join(OUT, f));
  for (const n of existsSync(out) ? readdirSync(out, { recursive: true }) : []) {
    if (/\.(jpe?g|png)$/i.test(n)) { mkdirSync(path.join(OUT, 'shots'), { recursive: true }); cpSync(path.join(out, n), path.join(OUT, 'shots', path.basename(n))); }
  }
  if (existsSync(path.join(OUT, 'verdict.json'))) {
    const v = JSON.parse(readFileSync(path.join(OUT, 'verdict.json'), 'utf8'));
    m.check.verdict = v.verdict; m.check.headline = v.headline;
  }
  writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(m, null, 2));
  console.log(`\ncheck: exit ${code} · ${m.check.verdict || '?'} · ${m.check.headline || ''}`);
}
