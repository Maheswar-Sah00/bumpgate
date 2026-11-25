// bumpgate replay: re-decide a recorded real run with the real gate code. No Kane, no keys, no credits.
// The input is Kane CLI's own NDJSON streams, saved by the GitHub Action on a real Dependabot PR.
// Every verdict printed here is computed now, by the same parseStream → classify → decide → guardrails
// that run in CI, and checked against what happened on GitHub.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStream, classify } from './kane.mjs';
import { decide } from './gate.mjs';
import { guardrails } from './fix.mjs';
import { color, lightText } from './log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CASE = path.join(HERE, '..', 'replay', 'pr4');

/** One recorded Kane run → the run record the gate reads (same fields runJourney returns). */
export function runFromStream(lines, label = '') {
  const parsed = parseStream(lines);
  // The process exit code is not in the stream; Kane's own final status is (test_md_done / test_md_summary).
  const overall = parsed.done?.overall_status || parsed.summary?.overall_status;
  const code = overall === 'passed' ? 0 : overall === 'failed' ? 1 : 2;
  const status = classify(code, parsed, false);
  return {
    label,
    status,
    exitCode: code,
    healed: status === 'passed' && (parsed.healTriggered || (parsed.summary?.steps?.author_decisions ?? 0) > 0),
    replayed: parsed.summary?.steps?.replay_decisions ?? null,
    reauthored: parsed.summary?.steps?.author_decisions ?? null,
    durationS: parsed.summary?.duration_s ?? parsed.done?.duration_s ?? null,
    failedStep: parsed.failedStep,
    reason: parsed.failedStep?.reason ?? null,
    bug: parsed.bug,
    diagnosis: parsed.diagnosis,
    sessionId: parsed.done?.session_id ?? null,
    cliVersion: parsed.cliVersion,
    consoleErrors: [],
    networkErrors: [],
  };
}

export function loadCase(dir = DEFAULT_CASE) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const read = (name) => {
    const f = path.join(dir, 'runs', name, 'kane.ndjson');
    if (!existsSync(f)) throw new Error(`missing recorded Kane stream: ${path.relative(process.cwd(), f)}`);
    return runFromStream(readFileSync(f, 'utf8').split(/\r?\n/), name);
  };
  const phases = manifest.phases.map((p) => {
    const rows = Object.entries(p.runs).map(([rel, sides]) => ({
      journey: { rel, title: manifest.journeys[rel] || rel },
      base: sides.base.map(read),
      bump: sides.bump.map(read),
    }));
    return { name: p.name, expect: p.expect, result: decide(rows) };
  });
  return { manifest, phases };
}

/** The guardrails the fix agent cannot get past, on the real fix and on a cheating variant. */
export function guardrailChecks(manifest) {
  const bumps = [{ name: manifest.bump.name }];
  const pkg = { dependencies: { [manifest.bump.name]: `^${manifest.bump.to}` } };
  const real = guardrails({ files: manifest.fix.files, bumps, headPkg: pkg, newPkg: pkg });
  const editsJourney = guardrails({ files: [...manifest.fix.files, '.kane/checkout_errors_test.md'], bumps, headPkg: pkg, newPkg: pkg });
  const undoesBump = guardrails({
    files: [...manifest.fix.files, 'package.json'], bumps, headPkg: pkg,
    newPkg: { dependencies: { [manifest.bump.name]: `^${manifest.bump.from}` } },
  });
  return { real, editsJourney, undoesBump };
}

export async function replay(args = {}) {
  const dir = path.resolve(args._?.[1] || DEFAULT_CASE);
  const out = (s = '') => process.stdout.write(s + '\n');
  const { manifest, phases } = loadCase(dir);
  let ok = true;

  out(color.bold(manifest.title));
  out(color.dim(`Recorded ${manifest.recorded}. PR: ${manifest.pr}`));
  out(color.dim(`Full Action log: ${manifest.run}`));
  out(color.dim('Replaying Kane CLI\'s saved NDJSON streams through the real gate code. No Kane run, no keys, no credits.'));

  for (const [i, ph] of phases.entries()) {
    out('');
    out(color.bold(`${i + 1}. ${ph.name}`));
    for (const row of ph.result.rows) {
      for (const side of ['base', 'bump']) {
        for (const r of row[side]) {
          const tag = r.status === 'passed' ? color.green('passed') : r.status === 'failed' ? color.red('failed') : color.amber(r.status);
          const where = r.failedStep ? ` at step ${r.failedStep.index} "${r.failedStep.heading}"` : '';
          out(`   ${side.padEnd(4)} · ${row.journey.title}: ${tag}${where}${r.durationS ? color.dim(` (${Math.round(r.durationS)}s)`) : ''}`);
          if (r.status === 'failed' && r.reason) out(color.dim(`          Kane: ${r.reason}`));
        }
      }
    }
    const res = ph.result;
    out('');
    for (const row of res.rows) {
      out(`   ${row.journey.title.padEnd(40)} ${lightText(row.decision.light)}  ${color.dim(row.decision.reasons[0])}`);
    }
    out(`   Rule "every journey that passes on main passes on the bump": ${res.rule.everyBasePassStillPasses ? color.green('holds') : color.red('broken')}`);
    out(`   Verdict: ${lightText(res.verdict === 'inconclusive' ? 'grey' : res.verdict)} ${res.headline} → ${color.bold(res.action)}`);
    const match = res.verdict === ph.expect;
    if (!match) ok = false;
    out(`   ${match ? color.green('✓') : color.red('✗')} matches what happened on GitHub (${ph.expect})`);

    if (i === 0 && res.verdict === 'red' && manifest.fix) {
      out('');
      out(color.bold('   Claude Code gets Kane\'s evidence as its task') + color.dim(` (replay/${path.basename(dir)}/${manifest.fix.task})`));
      const task = readFileSync(path.join(dir, manifest.fix.task), 'utf8');
      for (const l of task.split('\n').filter((l) => /^It passes on base|^Kane's (reason|bug verdict)|^Cannot read|^## Rules/.test(l))) out(color.dim(`     ${l}`));
      out(color.bold('   Claude Code\'s change') + color.dim(` (${manifest.fix.diff}, commit ${manifest.fixCommit})`));
      const diff = readFileSync(path.join(dir, manifest.fix.diff), 'utf8').split('\n').filter((l) => /^[-+](?![-+])/.test(l));
      for (const l of diff) out(`     ${l.startsWith('-') ? color.red(l) : color.green(l)}`);
      const g = guardrailChecks(manifest);
      out(color.bold('   Guardrails in code (src/fix.mjs)'));
      out(`     real fix:                         ${g.real ? color.red('rejected: ' + g.real) : color.green('accepted')}`);
      out(`     same fix + edits the journey:     ${g.editsJourney ? color.green('rejected') + color.dim(': ' + g.editsJourney) : color.red('accepted')}`);
      out(`     same fix + puts zod back to 3:    ${g.undoesBump ? color.green('rejected') + color.dim(': ' + g.undoesBump) : color.red('accepted')}`);
      if (g.real || !g.editsJourney || !g.undoesBump) ok = false;
    }
  }
  out('');
  out(ok
    ? color.bold(`Replayed: blocked on main vs bump, fixed by Claude Code, re-verified by Kane, merged (${manifest.pr}).`)
    : color.red('The replay does not match the recorded outcome.'));
  return ok ? 0 : 1;
}
