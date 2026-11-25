// The closed loop: Kane fails → agent migrates → code checks the guardrails → Kane re-verifies.
// Up to N attempts, then a human. The agent proposes; code and Kane decide.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { git, gitOk } from './sh.mjs';
import { buildTask, runAgent, AGENTS } from './agent.mjs';
import { releaseNotes } from './notes.mjs';
import { readJson } from './workspace.mjs';
import { lockVersions } from './deps.mjs';
import { pickFailure } from './gate.mjs';
import { resolveCommands } from './config.mjs';

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json'];

/** Files changed in a worktree (tracked edits + new untracked files), as repo-relative paths. */
export function changedFiles(dir) {
  // -z: NUL-separated, never trimmed or quoted, so the first entry keeps its full path.
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return [];
  return parsePorcelainZ(r.stdout);
}

export function parsePorcelainZ(out) {
  const parts = String(out).split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    files.push(e.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C') {
      files.push(parts[i + 1]); // the source path of a rename/copy counts as touched too
      i++;
    }
  }
  return files.filter(Boolean);
}

/**
 * The code-enforced rules on an agent's change. Returns a reason string to reject, or null.
 * Pure: everything it needs is passed in, so tests can pin it down.
 */
export function guardrails({ files, journeysDir = '.kane', protect = [], bumps = [], headPkg = {}, newPkg = {}, headLock = null, newLock = null,
  added = [], removed = [], asserted = [], maxChangedLines = 400 }) {
  if (!files.length) return 'the agent made no changes';
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const jd = norm(journeysDir).replace(/\/$/, '') + '/';
  const locked = [jd, 'bumpgate.config.json', '.bumpgate.json', '.github/workflows/', ...protect.map(norm)];
  for (const f of files.map(norm)) {
    for (const l of locked) {
      if (f === l || f.startsWith(l.endsWith('/') ? l : l + '/') || f === l.replace(/\/$/, '')) {
        return `it edited ${f}, which the agent may not touch`;
      }
    }
  }
  for (const b of bumps) {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const before = headPkg[field]?.[b.name];
      if (before === undefined) continue;
      const after = newPkg[field]?.[b.name];
      if (after !== before) return `it changed ${b.name} in package.json (${before} → ${after ?? 'removed'}); the bump must stay`;
    }
    if (headLock && newLock && headLock[b.name] && newLock[b.name] !== headLock[b.name]) {
      return `it changed the installed ${b.name} (${headLock[b.name]} → ${newLock[b.name] ?? 'removed'}); the bump must stay`;
    }
  }
  // Teaching to the test: a text the journeys verify must come from the app's logic, not be pasted in
  // by the fix. Moving an existing string is fine (it is on a removed line too); a new copy is not.
  const count = (lines, t) => lines.reduce((n, l) => n + (l.includes(t) ? 1 : 0), 0);
  for (const t of asserted) {
    if (t.length < 4) continue;
    if (count(added, t) > count(removed, t)) return `it added the text "${t}" that a journey checks for; the app must produce it, not hard-code it`;
  }
  const changed = added.length + removed.length;
  if (changed > maxChangedLines) return `it changed ${changed} lines (limit ${maxChangedLines}); a migration this large needs a human`;
  return null;
}

/** Quoted texts the journeys verify ("Verify the message "X" is shown"). */
export function assertedTexts(journeys = []) {
  const out = new Set();
  for (const j of journeys) {
    for (const line of String(j.text || '').split(/\r?\n/)) {
      if (!/\b(verify|check|assert|expect|see|shown|visible)\b/i.test(line)) continue;
      for (const m of line.matchAll(/["“]([^"”]{4,120})["”]/g)) out.add(m[1]);
    }
  }
  return [...out];
}

/** Added and removed lines of the agent's change (tracked diff plus new untracked files). Lockfiles are skipped. */
export function diffLines(dir) {
  const added = [];
  const removed = [];
  const d = spawnSync('git', ['diff', '-U0', '--no-color', 'HEAD', '--', '.', ...LOCKFILES.map((f) => `:(exclude,glob)**/${f}`)],
    { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  for (const l of (d.stdout || '').split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) added.push(l.slice(1));
    else if (l.startsWith('-')) removed.push(l.slice(1));
  }
  const u = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  for (const f of (u.stdout || '').split('\0').filter(Boolean)) {
    if (LOCKFILES.includes(path.basename(f))) continue;
    try { added.push(...readFileSync(path.join(dir, f), 'utf8').split('\n')); } catch { /* binary or gone */ }
  }
  return { added, removed };
}

function resetWorktree(dir, sha) {
  git(['reset', '--hard', sha], dir);
  gitOk(['clean', '-fd', '-e', 'node_modules', '-e', '.next', '-e', 'dist', '-e', 'build'], dir);
}

function failureInputs(row, taskDir) {
  const failed = pickFailure(row.bump) || row.bump[row.bump.length - 1] || {};
  const baseCon = new Set(row.base.flatMap((r) => r.consoleErrors || []));
  const shots = {};
  for (const side of ['base', 'bump']) {
    const src = row.shots?.[side];
    if (src && existsSync(src)) {
      const dst = path.join(taskDir, path.basename(src));
      copyFileSync(src, dst);
      shots[side] = dst;
    }
  }
  return {
    title: row.journey.title,
    text: row.journey.text || `# ${row.journey.title}\n\n${(row.journey.steps || []).map((s) => `## ${s}`).join('\n')}`,
    failedStep: failed.failedStep || null,
    reason: failed.reason || null,
    diagnosis: failed.diagnosis || null,
    bug: failed.bug || null,
    consoleErrors: (failed.consoleErrors || []).filter((c) => !baseCon.has(c)),
    networkErrors: (row.decision.newNetwork || []),
    failureText: failed.failureText || null,
    shots,
  };
}

export async function fixLoop(session, { agent = 'claude', maxAttempts = 3, log, onAttempt } = {}) {
  const meta = AGENTS[agent];
  if (!meta) throw new Error(`unknown agent "${agent}"`);
  const dir = session.bumpDir;
  const app = session.sideDir('bump');
  const startSha = git(['rev-parse', 'HEAD'], dir);
  const headPkg = readJson(path.join(app, 'package.json')) || {};
  const headLockJson = readJson(path.join(app, 'package-lock.json'));
  const headLock = headLockJson ? lockVersions(headLockJson) : null;
  const commands = resolveCommands(session.cfg, app);

  // Major bumps first; at most three packages' notes so the task stays readable.
  const bumps = [...(session.bumps || [])].sort((a, b) => Number(b.major) - Number(a.major)).slice(0, 3);
  log?.step(`Reading release notes for ${bumps.map((b) => `${b.name} ${b.from}→${b.to}`).join(', ') || 'the bump'}`);
  const notes = [];
  for (const b of bumps) {
    try { notes.push(await releaseNotes(b, app)); } catch { notes.push({ ...b, empty: true }); }
  }

  const attempts = [];
  let reinstall = false;
  for (let n = 1; n <= maxAttempts; n++) {
    const reds = session.last.rows.filter((r) => r.decision.light === 'red');
    if (!reds.length) break;
    const taskDir = path.join(session.work, 'agent', `attempt-${n}`);
    mkdirSync(taskDir, { recursive: true });
    const failures = reds.map((r) => failureInputs(r, taskDir));
    const task = buildTask({
      bump: bumps[0] || { name: 'the dependency', from: '?', to: '?' },
      failures,
      notes,
      journeysDir: session.cfg.journeys,
      buildCmd: commands.build,
      previous: attempts,
      protect: session.cfg.protect || [],
    });
    const taskFile = path.join(taskDir, 'task.md');
    writeFileSync(taskFile, task);
    log?.step(`${meta.name}, attempt ${n}/${maxAttempts}: migrating from Kane's evidence`);
    // Show what Kane handed the agent: the failed step, Kane's reason and verdict, console errors.
    for (const l of task.split('\n').filter((x) => /^It passes on base|^Kane's (reason|bug verdict)|^Console errors|^Cannot |^TypeError|^Error/.test(x)).slice(0, 8)) {
      log?.dim(`  ${l.replace(/\*\*/g, '')}`);
    }
    if (process.env.GITHUB_ACTIONS) {
      log?.raw(`::group::Full task handed to ${meta.name} (Kane's evidence + release notes)`);
      log?.raw(task.length > 20000 ? `${task.slice(0, 20000)}\n…(truncated; full text in the bumpgate artifact)` : task);
      log?.raw('::endgroup::');
    }
    onAttempt?.({ n, phase: 'agent' });

    const images = failures.flatMap((f) => [f.shots.bump, f.shots.base]).filter(Boolean);
    const res = await runAgent(agent, {
      cwd: dir,
      taskFile,
      outDir: path.join(session.outDir, 'transcripts'),
      attempt: n,
      images,
      onLine: (l) => { if (process.env.BUMPGATE_DEBUG) log?.dim(l.slice(0, 200)); },
    });
    const files = changedFiles(dir);
    const { added, removed } = diffLines(dir);
    const newPkg = readJson(path.join(app, 'package.json')) || {};
    const newLockJson = readJson(path.join(app, 'package-lock.json'));
    let rejected = guardrails({
      files,
      journeysDir: session.cfg.journeys,
      protect: session.cfg.protect || [],
      bumps: session.bumps || [],
      headPkg,
      newPkg,
      headLock,
      newLock: newLockJson ? lockVersions(newLockJson) : null,
      added,
      removed,
      asserted: assertedTexts(session.journeys),
      maxChangedLines: session.cfg.maxFixLines ?? 400,
    });
    if (!rejected && !res.ok && !files.length) rejected = `the agent exited (code ${res.code}${res.timedOut ? ', timed out' : ''})`;
    const attempt = { n, summary: res.summary, files, transcript: path.relative(session.outDir, res.transcriptPath), taskFile };

    if (rejected) {
      log?.fail(`Rejected by the code checks: ${rejected}`);
      attempt.rejected = rejected;
      attempt.diffStat = files.join(', ');
      attempts.push(attempt);
      resetWorktree(dir, startSha);
      continue;
    }

    log?.ok(`${meta.name} changed ${files.length} file(s): ${files.slice(0, 6).join(', ')}`);
    if (res.summary) log?.dim(`  ${meta.name}: ${res.summary.replace(/\s+/g, ' ').slice(0, 400)}`);
    log?.ok('Code checks passed: journeys untouched, the bump kept, no checked text hard-coded');
    log?.step('Handing back to Kane: re-run every journey on the migrated bump');
    onAttempt?.({ n, phase: 'kane' });
    const pkgTouched = files.some((f) => path.basename(f) === 'package.json' || LOCKFILES.includes(path.basename(f)));
    const v = await session.reverify({ reinstall: reinstall || pkgTouched });
    reinstall = pkgTouched;
    attempt.verdict = v.verdict;
    const stillRed = v.rows.find((r) => r.decision.light === 'red');
    if (stillRed) {
      const f = [...stillRed.bump].reverse().find((r) => r.status === 'failed');
      attempt.failedJourney = stillRed.journey.title;
      attempt.reason = f?.reason || (v.builds?.bump && !v.builds.bump.ok ? `the build failed at ${v.builds.bump.step}` : '');
    }
    attempts.push(attempt);

    if (v.verdict === 'green' || v.verdict === 'amber') {
      git(['add', '-A'], dir);
      const b = bumps[0];
      const msg = [
        `Migrate to ${b ? `${b.name} ${b.to}` : 'the upgrade'} (verified by Kane CLI)`,
        '',
        `Kane CLI replayed ${v.rows.length} journeys on base and on this upgrade. "${reds.map((r) => r.journey.title).join('", "')}" broke only on the upgrade.`,
        `${meta.name} rewrote the code from Kane's evidence and the release notes; Kane replayed every journey on the result and all of them pass.`,
      ].join('\n');
      git(['commit', '-q', '-m', msg], dir);
      const commit = git(['rev-parse', 'HEAD'], dir);
      log?.ok(`Kane re-verified: ${v.headline}. Committed ${commit.slice(0, 7)}.`);
      return { ok: true, agent, agentName: meta.name, attempts, commit, filesChanged: files, notesFrom: notes.flatMap((x) => x.links || []).slice(0, 4), result: v };
    }
    // Keep the change: the next attempt continues from it, with Kane's fresh evidence of what still fails.
    log?.fail(`Kane still fails: ${attempt.failedJourney || v.headline}`);
    attempt.diffStat = files.join(', ');
  }
  resetWorktree(dir, startSha);
  return { ok: false, agent, agentName: meta.name, attempts, commit: null, notesFrom: notes.flatMap((x) => x.links || []).slice(0, 4), result: session.last };
}
