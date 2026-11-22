// F1 Radar, free pre-check (no Kane, no agent): does the BASE app build and show a usable page with no backend?
// Also records whether the bump builds (a bump that does not build is blocked before Kane runs), but takes no
// screenshot of the bump: cases are chosen on the base app only, so the Radar is not cherry-picked.
//   node prebuild.mjs <id> [port]        -> radar/prebuild/<id>.json + .png
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkout, buildSide, serveSide } from 'file:///B:/Projects/Kane-CLI/bumpgate/src/workspace.mjs';
import { loadConfig } from 'file:///B:/Projects/Kane-CLI/bumpgate/src/config.mjs';
import { chromium } from 'file:///B:/Projects/ahola/game/app/node_modules/playwright-core/index.mjs';

process.env.npm_config_ignore_scripts = 'true'; // outside install scripts stay off
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = 'C:/bumpgate-work/radar'; // C: has the room; B: filled up on 22 Nov
{ // disk guard: never start a build with less than 8 GB free
  const free = Number(execFileSync('powershell', ['-NoProfile', '-Command', '(Get-PSDrive C).Free'], { encoding: 'utf8' }).trim());
  if (free < 8 * 2 ** 30) { console.error(`stopping: only ${(free / 2 ** 30).toFixed(1)} GB free on C:`); process.exit(4); }
}
const id = String(process.argv[2] || '').trim();
const port = Number(process.argv[3] || 4363);
const c = JSON.parse(readFileSync(path.join(HERE, 'cases.json'), 'utf8')).find((x) => x.id === id);
const OUT = path.join(HERE, 'prebuild');
mkdirSync(OUT, { recursive: true });
const WORK = path.join(ROOT, id);
const repoDir = path.join(WORK, 'repo');
const git = (args, cwd = repoDir) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const r = { id, repo: c.repo, pr: c.pr, t0: Date.now() };
const save = () => writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(r, null, 1));
try {
  const pr = c.kind === 'control' ? { state: 'MERGED', commits: [] }
    : JSON.parse(execFileSync('gh', ['pr', 'view', String(c.pr), '-R', c.repo, '--json', 'baseRefName,state,commits'], { encoding: 'utf8' }));
  r.state = pr.state; r.commits = pr.commits.length;
  if (!existsSync(path.join(repoDir, '.git'))) {
    mkdirSync(WORK, { recursive: true });
    git(['clone', '--filter=blob:none', '--no-checkout', '--quiet', `https://github.com/${c.repo}.git`, repoDir], WORK);
    git(['config', 'user.name', 'Bumpgate Radar']); git(['config', 'user.email', 'radar@localhost']); git(['config', 'core.autocrlf', 'false']);
  }
  let head, base;
  if (c.kind === 'control') { // merged and never reverted: the merge commit vs its first parent
    git(['fetch', '--quiet', 'origin', c.bump]);
    head = c.bump; base = git(['rev-parse', `${c.bump}^1`]);
  } else {
    git(['fetch', '--quiet', 'origin', pr.baseRefName, `+refs/pull/${c.pr}/head:refs/radar/pr`]);
    head = git(['rev-parse', 'refs/radar/pr']);
    base = git(['merge-base', `origin/${pr.baseRefName}`, head]);
  }
  r.base = base; r.head = head;
  const appDir = c.dir && c.dir !== '/' ? c.dir.replace(/^\//, '') : '';
  const cfg = loadConfig('B:/__none__', { appDir });
  for (const [side, sha] of [['base', base], ['bump', head]]) {
    const dir = path.join(WORK, `pre-${side}`);
    checkout(repoDir, sha, dir);
    const b = await buildSide(path.join(dir, appDir), cfg, {});
    r[side] = { ok: b.ok, step: b.step, seconds: b.seconds, log: b.ok ? '' : b.log.slice(-600), commands: b.commands };
    console.log(`${id} ${side}: ${b.ok ? 'built' : 'FAILED at ' + b.step} (${b.seconds}s)`);
    save();
  }
  if (r.base.ok) {
    const srv = await serveSide(path.join(WORK, 'pre-base', appDir), r.base.commands, port);
    const br = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; const failed = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    p.on('requestfailed', (q) => failed.push(q.url().slice(0, 120)));
    p.on('response', (s) => { if (s.status() >= 400) failed.push(`${s.status()} ${s.url().slice(0, 120)}`); });
    await p.goto(srv.url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errs.push('goto: ' + e.message.split('\n')[0]));
    await p.waitForTimeout(2000);
    await p.screenshot({ path: path.join(OUT, `${id}.png`) });
    r.text = (await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 700);
    r.buttons = await p.evaluate(() => [...document.querySelectorAll('button,a,input,select,textarea')].length).catch(() => 0);
    r.errors = errs; r.failed = [...new Set(failed)].slice(0, 12);
    await br.close(); await srv.stop();
  }
} catch (e) {
  r.error = String(e.message || e).slice(0, 600);
  console.log(`${id}: ERROR ${r.error}`);
}
r.seconds = Math.round((Date.now() - r.t0) / 1000);
save();
// free the disk: drop both build checkouts (the clone stays for the Kane run)
for (const side of ['base', 'bump']) {
  const dir = path.join(WORK, `pre-${side}`);
  try { git(['worktree', 'remove', '--force', dir]); } catch { /* not a worktree */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${id}: done in ${r.seconds}s`);
