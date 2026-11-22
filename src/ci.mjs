// GitHub Action entry: on a bot PR, compare base vs bump with Kane, fix on red, comment, merge.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Session } from './check.mjs';
import { loadConfig } from './config.mjs';
import { fixLoop } from './fix.mjs';
import { renderComment, renderRunning, oneLine } from './comment.mjs';
import { upsertComment, setLabels, mergeWhenGreen, uploadEvidence, viewerUrl, setStatus, statusFor } from './github.mjs';
import { isBotAuthor } from './deps.mjs';
import { git, gitOk, run } from './sh.mjs';
import { stemOf } from './kane.mjs';

/** Config is read from the BASE commit, so a PR cannot loosen its own gate. */
export function configAtBase(repoDir, sha, overrides) {
  for (const name of ['bumpgate.config.json', '.bumpgate.json']) {
    const r = gitOk(['show', `${sha}:${name}`], repoDir);
    if (r.ok) {
      const cfg = loadConfig(repoDir, { ...JSON.parse(r.out), ...overrides });
      cfg.file = `${name}@${sha.slice(0, 7)}`;
      return cfg;
    }
  }
  const cfg = loadConfig('/nonexistent-bumpgate-config-dir', overrides);
  return cfg;
}

async function agentAvailable(kind) {
  if (kind === 'none') return false;
  const r = await run(kind === 'codex' ? 'codex' : 'claude', ['--version'], { timeoutMs: 20000 });
  return r.code === 0;
}

export async function ci({ log, overrides = {} }) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) throw new Error('bumpgate ci runs inside GitHub Actions (GITHUB_EVENT_PATH is missing). Use `bumpgate check` locally.');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) throw new Error('bumpgate ci needs a pull_request event.');
  const repo = process.env.GITHUB_REPOSITORY;
  const repoDir = process.env.GITHUB_WORKSPACE || process.cwd();
  const labels = (pr.labels || []).map((l) => l.name);
  const forced = process.env.BUMPGATE_FORCE === 'true' || labels.includes('bumpgate');
  if (!isBotAuthor(pr.user?.login) && !forced) {
    log.info(`PR #${pr.number} is by ${pr.user?.login}, not a dependency bot. Skipping (add the "bumpgate" label to force).`);
    return 0;
  }

  gitOk(['fetch', '--no-tags', 'origin', pr.base.sha, pr.head.sha], repoDir);
  const mergeBase = gitOk(['merge-base', pr.base.sha, pr.head.sha], repoDir).out || pr.base.sha;
  const cfg = configAtBase(repoDir, mergeBase, overrides);
  const outDir = path.join(process.env.RUNNER_TEMP || repoDir, 'bumpgate-out');
  const session = new Session({ repoDir, base: mergeBase, head: pr.head.sha, title: pr.title, cfg, outDir, log });
  session.prepare();

  const runUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const safe = async (what, fn) => {
    try { return await fn(); } catch (e) { log.warn(`${what}: ${e.message}`); return null; }
  };
  await safe('comment', () => upsertComment(repo, pr.number, renderRunning({ bumps: session.bumps, journeys: session.journeys, base: session.baseSha, head: session.headSha })));

  const result = await session.compare();
  log.raw(oneLine(result));

  let fix = null;
  if (result.verdict === 'red' && cfg.agent !== 'none') {
    const sameRepo = pr.head.repo?.full_name === repo;
    if (!sameRepo) {
      result.notes.push('The PR comes from a fork, so Bumpgate cannot push a migration to it.');
    } else if (!(await agentAvailable(cfg.agent))) {
      result.notes.push(`The fix agent (${cfg.agent}) is not installed or has no key, so no migration was attempted.`);
    } else {
      process.env.GIT_AUTHOR_NAME ||= 'github-actions[bot]';
      process.env.GIT_AUTHOR_EMAIL ||= '41898282+github-actions[bot]@users.noreply.github.com';
      process.env.GIT_COMMITTER_NAME ||= process.env.GIT_AUTHOR_NAME;
      process.env.GIT_COMMITTER_EMAIL ||= process.env.GIT_AUTHOR_EMAIL;
      fix = await fixLoop(session, { agent: cfg.agent, maxAttempts: cfg.maxFixAttempts, log });
      if (fix.ok) {
        git(['push', 'origin', `${fix.commit}:refs/heads/${pr.head.ref}`], repoDir);
        log.ok(`Pushed ${fix.commit.slice(0, 7)} to ${pr.head.ref}`);
      }
    }
  }

  // Evidence: screenshots for every red/amber journey, on an orphan branch. Raw packs carry the
  // Kane account's email and org ids, so they are published only when the repo opts in.
  const publishPacks = process.env.BUMPGATE_PUBLISH_PACKS === 'true' || cfg.publishPacks === true;
  const shotUrls = {};
  const packUrls = {};
  const shotKey = (prefix, stem, side, file) => `${prefix}/${stem}-${side}${path.extname(file) || '.png'}`;
  const rowsForEvidence = result.rows.filter((r) => ['red', 'amber'].includes(r.decision.light));
  if (rowsForEvidence.length) {
    const files = {};
    const prefix = `pr-${pr.number}/${process.env.GITHUB_RUN_ID || Date.now()}`;
    for (const row of rowsForEvidence) {
      const stem = stemOf(row.journey.rel);
      for (const side of ['base', 'bump']) {
        if (row.shots?.[side] && existsSync(row.shots[side])) files[shotKey(prefix, stem, side, row.shots[side])] = row.shots[side];
      }
      if (publishPacks) {
        const bumpPack = [...row.bump].reverse().find((r) => r.pack && existsSync(r.pack));
        const basePack = [...row.base].reverse().find((r) => r.pack && existsSync(r.pack) && r.status === 'passed');
        if (basePack) files[`${prefix}/${stem}-base.evidence`] = basePack.pack;
        if (bumpPack) files[`${prefix}/${stem}-bump.evidence`] = bumpPack.pack;
      }
    }
    const urls = await safe('evidence upload', () => uploadEvidence(repo, files, { message: `Evidence for PR #${pr.number}` }));
    if (urls) {
      for (const row of rowsForEvidence) {
        const stem = stemOf(row.journey.rel);
        shotUrls[row.journey.rel] = {
          base: row.shots?.base ? urls[shotKey(prefix, stem, 'base', row.shots.base)] : undefined,
          bump: row.shots?.bump ? urls[shotKey(prefix, stem, 'bump', row.shots.bump)] : undefined,
        };
        const p = {};
        if (urls[`${prefix}/${stem}-base.evidence`]) p.base = viewerUrl(urls[`${prefix}/${stem}-base.evidence`]);
        if (urls[`${prefix}/${stem}-bump.evidence`]) p.bump = viewerUrl(urls[`${prefix}/${stem}-bump.evidence`]);
        if (Object.keys(p).length) packUrls[row.journey.rel] = p;
      }
    }
  }

  const final = fix?.ok ? fix.result : result;
  const state = fix ? (fix.ok ? 'fixed' : 'needs-human') : result.verdict;
  const action = fix?.ok ? final.action : fix ? 'block' : result.action;
  const body = renderComment(result, { state, fix, shotUrls, packUrls, runUrl, repo, pr: pr.number, actionOverride: action });
  await safe('comment', () => upsertComment(repo, pr.number, body));

  const label = { green: 'bumpgate: green', amber: 'bumpgate: amber', red: 'bumpgate: red', fixed: 'bumpgate: fixed', 'needs-human': 'needs-human' }[state];
  await safe('labels', () => setLabels(repo, pr.number, label ? [label] : []));

  const verifiedSha = fix?.ok && fix.commit ? fix.commit : pr.head.sha;
  await safe('status', () => setStatus(repo, verifiedSha, { ...statusFor(state, final, action), targetUrl: runUrl }));

  if (action === 'merge' && cfg.autoMerge !== false) {
    const how = await safe('merge', () => mergeWhenGreen(repo, pr.number));
    if (how) log.ok(`PR #${pr.number}: ${how}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${final.verdict}\nstate=${state}\n`);

  return ['green', 'amber', 'fixed'].includes(state) ? 0 : 1;
}
