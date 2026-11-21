// Base vs bump: build both, replay every journey with Kane on each, then apply the rule.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkout, buildSide, serveSide, resolveRef, workRoot, readJson } from './workspace.mjs';
import { runJourney, adoptRecording, makeBudget, stemOf, BudgetError } from './kane.mjs';
import { decide, needsConfirmation } from './gate.mjs';
import { summariseBump, lockVersions, bumpLabel } from './deps.mjs';
import { readPack } from './evidence.mjs';
import { gitOk } from './sh.mjs';

/** Find *_test.md journeys under dir (recursive), skipping output folders. */
export function listJourneys(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('output-') || n === 'node_modules' || n.startsWith('.testmuai')) continue;
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/_test\.md$/i.test(n)) out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort().map((rel) => {
    const text = readFileSync(path.join(dir, rel), 'utf8');
    const title = (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() || humanise(stemOf(rel));
    const steps = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
    return { rel: rel.split(path.sep).join('/'), title, steps, text };
  });
}

function humanise(s) {
  return s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export class Session {
  constructor({ repoDir, base, head, title = '', cfg, outDir, log, runner = runJourney }) {
    this.repoDir = path.resolve(repoDir);
    this.cfg = cfg;
    this.log = log;
    this.runner = runner;
    this.title = title;
    this.baseSha = resolveRef(this.repoDir, base);
    this.headSha = resolveRef(this.repoDir, head);
    this.work = workRoot(this.repoDir);
    this.baseDir = path.join(this.work, 'base');
    this.bumpDir = path.join(this.work, 'bump');
    this.seedDir = path.join(this.work, 'seed');
    this.runsDir = path.join(this.work, 'runs');
    this.outDir = path.resolve(outDir || path.join(this.repoDir, '.bumpgate'));
    this.budget = makeBudget(cfg.kane.maxRuns);
    this.results = {};
    this.notes = [];
    this.builds = {};
  }

  prepare() {
    this.log.step(`Checking out base ${this.baseSha.slice(0, 7)} and bump ${this.headSha.slice(0, 7)}`);
    checkout(this.repoDir, this.baseSha, this.baseDir);
    checkout(this.repoDir, this.headSha, this.bumpDir);

    const basePkg = readJson(path.join(this.baseDir, 'package.json')) || {};
    const headPkg = readJson(path.join(this.bumpDir, 'package.json')) || {};
    const baseLock = readJson(path.join(this.baseDir, 'package-lock.json'));
    const headLock = readJson(path.join(this.bumpDir, 'package-lock.json'));
    this.bumps = summariseBump({
      title: this.title,
      basePkg,
      headPkg,
      baseLock: baseLock ? lockVersions(baseLock) : null,
      headLock: headLock ? lockVersions(headLock) : null,
    });
    this.log.info(`Bump: ${bumpLabel(this.bumps)}`);

    // Journeys always come from BASE: a PR (or the fix agent) cannot weaken its own exam.
    const journeysDir = path.join(this.baseDir, this.cfg.journeys);
    this.journeys = listJourneys(journeysDir);
    if (!this.journeys.length) {
      throw new Error(`No journeys found in ${this.cfg.journeys}/ on base. Run \`bumpgate init\` to create them.`);
    }
    const changed = gitOk(['diff', '--name-only', this.baseSha, this.headSha, '--', this.cfg.journeys], this.repoDir);
    if (changed.ok && changed.out) {
      this.notes.push('This PR edits journey files. They were ignored: journeys always come from the base branch.');
    }
    rmSync(this.seedDir, { recursive: true, force: true });
    cpSync(journeysDir, this.seedDir, { recursive: true });
    for (const j of this.journeys) this.results[j.rel] = { journey: j, base: [], bump: [] };
    this.log.info(`${this.journeys.length} journeys: ${this.journeys.map((j) => j.title).join(' · ')}`);
  }

  async build(side, { skipInstall = false } = {}) {
    const dir = side === 'base' ? this.baseDir : this.bumpDir;
    this.log.step(`Building ${side}`);
    const r = await buildSide(dir, this.cfg, { onLog: (s) => this.log.dim(s), skipInstall });
    this.builds[side] = r;
    if (r.ok) this.log.ok(`${side} built in ${r.seconds}s`);
    else this.log.fail(`${side} failed at ${r.step}`);
    return r;
  }

  async runSide(side, rels, attempt = 1) {
    const dir = side === 'base' ? this.baseDir : this.bumpDir;
    const port = this.cfg.port || 4319;
    const server = await serveSide(dir, this.builds[side].commands, port);
    this.log.step(`Kane on ${side} (${server.url})`);
    try {
      for (const rel of rels) {
        const row = this.results[rel];
        const n = row[side].length + 1;
        const runDir = path.join(this.runsDir, `${side}-${stemOf(rel)}-${attempt}-${n}`);
        let res;
        try {
          res = await this.runner({
            journeyRel: rel,
            seedDir: this.seedDir,
            runDir,
            url: server.url,
            label: `${side}:${stemOf(rel)}`,
            kane: this.cfg.kane,
            budget: this.budget,
          });
        } catch (e) {
          if (e instanceof BudgetError) throw e;
          res = { status: 'error', reason: e.message, label: `${side}:${stemOf(rel)}` };
        }
        row[side].push(res);
        const tag = res.status === 'passed' ? (res.healed ? 'passed after self-heal' : res.authored ? 'passed (recorded)' : 'passed')
          : res.status === 'failed' ? `failed${res.failedStep ? ` at "${res.failedStep.heading}"` : ''}` : `error: ${res.reason || 'unknown'}`;
        const fn = res.status === 'passed' ? this.log.ok : res.status === 'failed' ? this.log.fail : this.log.warn;
        fn(`${side} · ${row.journey.title}: ${tag}${res.durationS ? ` (${res.durationS}s)` : ''}`);
        if (side === 'base' && res.status === 'passed' && res.authored && res.testPath) {
          adoptRecording(res, this.seedDir, rel);
        }
      }
    } finally {
      await server.stop();
    }
  }

  /** The whole comparison. */
  async compare() {
    const rels = this.journeys.map((j) => j.rel);
    const [b, h] = [await this.build('base'), await this.build('bump')];
    if (!b.ok) {
      this.notes.push(`Base does not ${b.step}, so nothing can be compared.`);
      for (const rel of rels) this.results[rel].base.push({ status: 'error', reason: `base ${b.step} failed` });
      return this.finish();
    }
    await this.runSide('base', rels);
    if (!h.ok) {
      this.notes.push(`The bump does not ${h.step}. Every journey counts as broken.`);
      for (const rel of rels) this.results[rel].bump.push({ status: 'failed', reason: `bump ${h.step} failed`, buildLog: h.log });
      return this.finish();
    }
    await this.runSide('bump', rels);
    await this.confirm();
    return this.finish();
  }

  /** Re-run only journeys whose sides disagree, until majority is clear. */
  async confirm() {
    const max = this.cfg.confirmRuns || 3;
    for (let round = 2; round <= max; round++) {
      const bumpAgain = [];
      const baseAgain = [];
      for (const [rel, row] of Object.entries(this.results)) {
        const need = needsConfirmation(row, max);
        if (need === 'bump') bumpAgain.push(rel);
        if (need === 'base') baseAgain.push(rel);
      }
      if (!bumpAgain.length && !baseAgain.length) return;
      if (bumpAgain.length) {
        this.log.step(`Confirming ${bumpAgain.length} disagreement(s) on the bump (round ${round}/${max})`);
        await this.runSide('bump', bumpAgain, round);
      }
      if (baseAgain.length) {
        this.log.step(`Re-checking ${baseAgain.length} journey(s) on base (round ${round}/${max})`);
        await this.runSide('base', baseAgain, round);
      }
    }
  }

  /** Re-verify the bump side only (after the fix agent changed it). */
  async reverify({ reinstall = false } = {}) {
    for (const row of Object.values(this.results)) row.bump = [];
    const h = await this.build('bump', { skipInstall: !reinstall });
    const rels = this.journeys.map((j) => j.rel);
    if (!h.ok) {
      for (const rel of rels) this.results[rel].bump.push({ status: 'failed', reason: `bump ${h.step} failed`, buildLog: h.log });
      return this.finish();
    }
    await this.runSide('bump', rels, 'fix');
    await this.confirm();
    return this.finish();
  }

  finish() {
    const rows = Object.values(this.results);
    const result = decide(rows, { amber: this.cfg.amber });
    result.bumps = this.bumps;
    result.base = this.baseSha;
    result.head = this.headSha;
    result.notes = [...this.notes];
    result.kaneRuns = this.budget.used;
    result.builds = Object.fromEntries(Object.entries(this.builds).map(([k, v]) => [k, { ok: v.ok, step: v.step, seconds: v.seconds, log: v.ok ? '' : v.log }]));
    this.collectShots(result);
    this.last = result;
    this.save(result);
    return result;
  }

  /** Pull the base/bump screenshot pair for each red or amber journey out of the packs. */
  collectShots(result) {
    const shotsDir = path.join(this.outDir, 'shots');
    for (const row of result.rows) {
      if (!['red', 'amber'].includes(row.decision.light)) continue;
      const stem = stemOf(row.journey.rel);
      const bumpRun = [...row.bump].reverse().find((r) => r.pack && (r.status === 'failed' || r.healed)) || [...row.bump].reverse().find((r) => r.pack);
      const baseRun = [...row.base].reverse().find((r) => r.pack && r.status === 'passed');
      row.shots = {};
      try {
        if (bumpRun) {
          const pack = readPack(bumpRun.pack);
          const entry = pack.failure?.screenshot || pack.lastScreenshot;
          if (entry) {
            row.shots.bump = pack.extract(entry, path.join(shotsDir, `${stem}-bump.png`));
            const ord = (entry.match(/steps\/(\d+)-/) || [])[1];
            if (baseRun && ord) {
              const bp = readPack(baseRun.pack);
              const twin = bp.screenshots.find((s) => s.includes(`/steps/${ord}-`)) || bp.lastScreenshot;
              if (twin) row.shots.base = bp.extract(twin, path.join(shotsDir, `${stem}-base.png`));
            }
          }
        }
      } catch (e) {
        row.shots.error = e.message;
      }
    }
  }

  save(result) {
    mkdirSync(this.outDir, { recursive: true });
    writeFileSync(path.join(this.outDir, 'verdict.json'), JSON.stringify(slim(result), null, 2));
  }
}

/** Drop bulky fields before writing verdict.json. */
export function slim(result) {
  return {
    ...result,
    rows: result.rows.map((r) => ({
      journey: { rel: r.journey.rel, title: r.journey.title, steps: r.journey.steps },
      decision: r.decision,
      shots: r.shots,
      base: r.base.map(slimRun),
      bump: r.bump.map(slimRun),
    })),
  };
}

function slimRun(r) {
  const { testPath, runDir, buildLog, ...rest } = r;
  return { ...rest, runDir, buildLog: buildLog ? String(buildLog).slice(-1500) : undefined };
}
