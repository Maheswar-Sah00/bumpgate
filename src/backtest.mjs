// Replay real bot bumps that maintainers later reverted (and controls that were never reverted).
// Produces the headline: "CI passed N of N. Kane would have stopped X."
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { Session, slim } from './check.mjs';
import { loadConfig } from './config.mjs';
import { gitOk, git } from './sh.mjs';
import { stemOf } from './kane.mjs';
import { workRoot } from './workspace.mjs';

export function cloneOrFetch(repo, dir, shas) {
  if (!existsSync(path.join(dir, '.git'))) {
    mkdirSync(path.dirname(dir), { recursive: true });
    git(['clone', '--filter=blob:none', '--no-checkout', '--quiet', `https://github.com/${repo}.git`, dir], path.dirname(dir));
  }
  for (const sha of shas) {
    if (!gitOk(['cat-file', '-e', `${sha}^{commit}`], dir).ok) git(['fetch', '--quiet', 'origin', sha], dir);
  }
  return dir;
}

export function summarise(results) {
  const reverted = results.filter((r) => r.kind === 'reverted');
  const controls = results.filter((r) => r.kind === 'control');
  const ciPassed = reverted.filter((r) => r.ci === 'passed' || r.ci === 'no checks');
  const stopped = ciPassed.filter((r) => ['red'].includes(r.verdict));
  const flagged = ciPassed.filter((r) => ['amber'].includes(r.verdict));
  const falseAlarms = controls.filter((r) => ['red'].includes(r.verdict));
  const controlAmber = controls.filter((r) => r.verdict === 'amber');
  return {
    reverted: reverted.length,
    ciPassed: ciPassed.length,
    stopped: stopped.length,
    flagged: flagged.length,
    controls: controls.length,
    falseAlarms: falseAlarms.length,
    controlAmber: controlAmber.length,
    inconclusive: results.filter((r) => r.verdict === 'inconclusive').length,
    headline: `CI passed ${ciPassed.length} of ${ciPassed.length} real bot bumps that maintainers later reverted. Kane would have stopped ${stopped.length}${flagged.length ? ` and flagged ${flagged.length} more` : ''}.`,
    controlLine: `${controls.length} bumps that were never reverted: ${falseAlarms.length} false alarm${falseAlarms.length === 1 ? '' : 's'}${controlAmber.length ? `, ${controlAmber.length} amber` : ''}.`,
  };
}

export async function backtest(args, overrides, log) {
  const casesFile = path.resolve(args._[1] || 'corpus/cases.json');
  const root = path.dirname(casesFile);
  const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
  const only = args.only ? String(args.only).split(',') : null;
  const resultsDir = path.resolve(args.out || path.join(root, 'results'));
  mkdirSync(resultsDir, { recursive: true });
  const reposDir = path.join(process.env.BUMPGATE_WORK || path.join(root, '.work'), 'repos');

  const results = [];
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    if (c.skip) { log.warn(`${c.id}: skipped (${c.skip})`); continue; }
    log.raw('');
    log.step(`${c.id}: ${c.repo} · ${c.package} ${c.from} → ${c.to} (${c.kind})`);
    const resultFile = path.join(resultsDir, `${c.id}.json`);
    if (existsSync(resultFile) && !args.rerun) {
      const prev = JSON.parse(readFileSync(resultFile, 'utf8'));
      log.info(`cached: ${prev.verdict} (use --rerun to run again)`);
      results.push(prev.summary);
      continue;
    }
    const repoDir = cloneOrFetch(c.repo, path.join(reposDir, c.repo.replace('/', '__')), [c.base, c.bump]);
    const cfg = loadConfig(path.join(root, '__none__'), {
      ...overrides,
      appDir: c.appDir || '',
      install: c.install || null,
      build: c.build || null,
      serve: c.serve || null,
      agent: 'none',
      kane: { ...(overrides.kane || {}), ...(c.kane || {}) },
    });
    const outDir = path.join(resultsDir, c.id);
    const journeysDir = path.resolve(root, c.journeys || c.id);
    let result;
    try {
      const session = new Session({
        repoDir, base: c.base, head: c.bump, cfg, outDir, log, journeysDir,
        title: `Bump ${c.package} from ${c.from} to ${c.to}`,
      });
      session.prepare();
      result = await session.compare();
    } catch (e) {
      log.fail(`${c.id}: ${e.message}`);
      result = { verdict: 'inconclusive', headline: e.message, rows: [], counts: {}, error: e.message };
    }
    // Keep every sealed pack next to the result so each claim links to Kane's own evidence.
    const packs = {};
    for (const row of result.rows || []) {
      for (const side of ['base', 'bump']) {
        row[side].forEach((run, i) => {
          if (run.pack && existsSync(run.pack)) {
            const dest = path.join(outDir, 'packs', `${stemOf(row.journey.rel)}-${side}-${i + 1}.evidence`);
            mkdirSync(path.dirname(dest), { recursive: true });
            copyFileSync(run.pack, dest);
            (packs[row.journey.rel] ||= []).push(path.relative(root, dest).split(path.sep).join('/'));
          }
        });
      }
    }
    const summary = {
      id: c.id, kind: c.kind, repo: c.repo, pr: c.pr, package: c.package, from: c.from, to: c.to, ci: c.ci,
      broke: c.broke || null, verdict: result.verdict, headline: result.headline, counts: result.counts,
      kaneRuns: result.kaneRuns ?? null, packs,
    };
    writeFileSync(resultFile, JSON.stringify({ ...(result.rows ? slim(result) : result), summary }, null, 2));
    log.raw(`  → ${result.verdict}: ${result.headline}`);
    results.push(summary);
  }

  const all = [...results];
  const s = summarise(all);
  const md = renderResults(all, s);
  writeFileSync(path.join(root, 'RESULTS.md'), md);
  writeFileSync(path.join(root, 'results.json'), JSON.stringify({ summary: s, cases: all }, null, 2));
  log.raw('');
  log.raw(s.headline);
  log.raw(s.controlLine);
  return 0;
}

export function renderResults(rows, s) {
  const L = ['# Backtest: real bot bumps that maintainers reverted', '', `**${s.headline}**`, '', s.controlLine, ''];
  L.push('| Case | Bump | CI on the bot PR | What the maintainer saw | Kane verdict | Evidence |');
  L.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    const light = { green: '🟢 green', amber: '🟡 amber', red: '🔴 red', inconclusive: '⚪ inconclusive' }[r.verdict] || r.verdict;
    const ev = Object.values(r.packs || {}).flat().slice(0, 2).map((p, i) => `[pack ${i + 1}](${p})`).join(' · ');
    L.push(`| ${r.kind === 'control' ? 'control · ' : ''}[${r.repo}#${r.pr}](https://github.com/${r.repo}/pull/${r.pr}) | \`${r.package}\` ${r.from} → ${r.to} | ${r.ci} | ${r.broke || '–'} | ${light} | ${ev || '–'} |`);
  }
  return L.join('\n') + '\n';
}

export { workRoot };
