// Drive Kane CLI: replay one plain-English journey against one build, read its NDJSON stream.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { run } from './sh.mjs';
import { readPack } from './evidence.mjs';

export class BudgetError extends Error {}

/** A hard cap on Kane runs per invocation, enforced in code before each spawn. */
export function makeBudget(maxRuns = 30) {
  return { maxRuns, used: 0 };
}

export function stemOf(file) {
  return path.basename(file).replace(/_test\.md$/i, '');
}

export function hasRecording(journeyPath) {
  const out = path.join(path.dirname(journeyPath), `output-${stemOf(journeyPath)}`);
  if (!existsSync(out)) return false;
  // Kane writes output-<stem>/.internal/meta.json after every authoring run, even a failed or
  // uncommitted (--local) one. Only a commit writes the step tapes under .internal/steps/.
  const internal = path.join(out, '.internal');
  return existsSync(internal) ? hasFile(path.join(internal, 'steps')) : hasFile(out);
}

function hasFile(dir) {
  if (!existsSync(dir)) return false;
  try {
    const walk = (d) => readdirSync(d).some((n) => {
      const p = path.join(d, n);
      return statSync(p).isDirectory() ? walk(p) : true;
    });
    return walk(dir);
  } catch {
    return false;
  }
}

/** Parse a Kane `testmd run --agent` NDJSON stream into one result object. */
export function parseStream(lines) {
  const r = {
    events: 0,
    steps: {},
    failedStep: null,
    reasons: [],
    oneLiners: [],
    credits: 0,
    healTriggered: false,
    summary: null,
    done: null,
    bug: null,
    diagnosis: null,
    reasonCode: null,
    verdict: null,
    errors: [],
    warnings: [],
    cliVersion: null,
  };
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    r.events++;
    switch (ev.type) {
      case 'stream_start':
        r.cliVersion = ev.cli_version ?? null;
        break;
      case 'test_md_step_start':
        r.steps[ev.step_index] = { index: ev.step_index, heading: ev.heading, status: 'running' };
        break;
      case 'test_md_step_end': {
        const s = r.steps[ev.step_index] || { index: ev.step_index };
        s.status = ev.status;
        s.durationS = ev.duration_s;
        r.steps[ev.step_index] = s;
        if (ev.status === 'failed' && !r.failedStep) r.failedStep = { ...s };
        break;
      }
      case 'run_end':
        if (ev.reason) r.reasons.push(String(ev.reason));
        if (ev.one_liner) r.oneLiners.push(String(ev.one_liner));
        if (typeof ev.credits_consumed === 'number') r.credits += ev.credits_consumed;
        // `summary` is Kane's diagnosis of a failure: root cause, suggested fix, and the evidence lines.
        if (ev.status === 'failed' && ev.summary) r.diagnosis = String(ev.summary);
        if (ev.status === 'failed' && ev.reason_code) r.reasonCode = String(ev.reason_code);
        break;
      case 'test_md_adaptive_heal':
        r.healTriggered = true;
        break;
      case 'test_md_bug_verdict':
        if (ev.confirmed || !r.bug) {
          r.bug = { confirmed: !!ev.confirmed, title: ev.bug_title ?? null, severity: ev.severity ?? null,
            confidence: ev.confidence ?? null, category: ev.category_name ?? ev.category ?? null, step: ev.step_index ?? null };
        }
        break;
      case 'test_md_summary':
        r.summary = ev;
        if (ev.adaptive_heal && ev.adaptive_heal.triggered) r.healTriggered = true;
        break;
      case 'test_md_done':
        r.done = ev;
        break;
      case 'verdict':
        r.verdict = ev;
        break;
      case 'error':
        r.errors.push(ev.message || ev.code || JSON.stringify(ev).slice(0, 300));
        break;
      case 'warning':
        r.warnings.push(ev.message || ev.code || '');
        break;
      default:
        break;
    }
  }
  if (r.failedStep) {
    // The last inner reason before the failure is what went wrong.
    r.failedStep.reason = r.oneLiners[r.oneLiners.length - 1] || r.reasons[r.reasons.length - 1] || null;
  }
  return r;
}

/** Map exit code + stream to passed | failed | error. */
export function classify(code, parsed, timedOut) {
  if (timedOut) return 'error';
  const overall = parsed.done?.overall_status || parsed.summary?.overall_status;
  const anyStepEnded = Object.values(parsed.steps).some((s) => s.status && s.status !== 'running');
  if (code === 0 && overall !== 'failed') return 'passed';
  if (code === 2) return 'error';
  if ((code === 1 || code === 3) && overall === 'failed' && anyStepEnded) return 'failed';
  if (code === 1 && anyStepEnded) return 'failed';
  return 'error';
}

/**
 * Run one journey once against `url`, in an isolated copy of the journeys folder so a
 * heal on one side can never rewrite the recordings the other side replays.
 */
export async function runJourney({
  journeyRel,          // path of the _test.md relative to the journeys dir
  seedDir,             // journeys dir holding the canonical recordings
  runDir,              // fresh dir for this run
  url,
  label = '',
  kane = {},
  budget,
  onLine,
  commit = false,      // true only when recording on the base branch: Kane saves step tapes only on a commit
}) {
  if (budget) {
    if (budget.used >= budget.maxRuns) {
      throw new BudgetError(`Kane run budget reached (${budget.maxRuns} runs). Raise kane.maxRuns to allow more.`);
    }
    budget.used++;
  }
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  const work = path.join(runDir, 'journeys');
  cpSync(seedDir, work, { recursive: true });
  const testPath = path.join(work, journeyRel);
  const recorded = hasRecording(testPath);

  const args = ['testmd', 'run', testPath, '--override-start-url', url, '--agent',
    '--timeout', String(kane.timeout ?? 300), '--max-steps', String(kane.maxSteps ?? 30)];
  if (!kane.headed) args.push('--headless');
  // --local skips Kane's commit and upload, so a heal on a bump can never rewrite main's recording.
  // It also means nothing is saved, so the one run that records a journey on base commits.
  if (kane.local !== false && !commit) args.push('--local');
  if (kane.bugDetection) args.push('--bug-detection', kane.bugDetection);
  for (const p of kane.policies || []) args.push('--policy', p);
  if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY) {
    args.push('--username', process.env.LT_USERNAME, '--access-key', process.env.LT_ACCESS_KEY);
  }

  const lines = [];
  const started = Date.now();
  const res = await run('kane-cli', args, {
    cwd: runDir,
    timeoutMs: hardLimitS(kane, readFileSync(testPath, 'utf8'), recorded) * 1000,
    env: { NO_COLOR: '1', FORCE_COLOR: '0' },
    onLine: (line) => {
      lines.push(line);
      if (onLine) onLine(line, label);
    },
  });
  writeFileSync(path.join(runDir, 'kane.ndjson'), lines.join('\n'));
  writeFileSync(path.join(runDir, 'kane.stderr.txt'), res.stderr || '');

  const parsed = parseStream(lines);
  const status = classify(res.code, parsed, res.timedOut);
  const packPath = findPack(runDir, res.stderr);
  let pack = null;
  if (packPath) {
    try { pack = readPack(packPath); } catch (e) { parsed.warnings.push(`could not read evidence pack: ${e.message}`); }
  }

  const authored = !recorded;
  const healed = status === 'passed' && recorded && (parsed.healTriggered || (parsed.summary?.steps?.author_decisions ?? 0) > 0);

  return {
    label,
    status,
    exitCode: res.code,
    timedOut: res.timedOut,
    durationS: Math.round((Date.now() - started) / 1000),
    authored,
    healed,
    committed: parsed.summary?.commit?.committed ?? null,
    replayed: parsed.summary?.steps?.replay_decisions ?? null,
    reauthored: parsed.summary?.steps?.author_decisions ?? null,
    failedStep: parsed.failedStep,
    reason: parsed.failedStep?.reason || (status === 'error'
      ? (parsed.errors[0] || (res.timedOut ? `stopped by Bumpgate after ${Math.round((Date.now() - started) / 1000)}s with no result from Kane` : lastLine(stripNotices(res.stderr))))
      : null),
    bug: parsed.bug,
    diagnosis: parsed.diagnosis,
    reasonCode: parsed.reasonCode,
    verdict: parsed.verdict,
    credits: parsed.credits || null,
    sessionId: parsed.done?.session_id ?? null,
    shareUrl: parsed.done?.share_url ?? parsed.summary?.share_url ?? null,
    cliVersion: parsed.cliVersion,
    consoleErrors: pack?.consoleErrors ?? [],
    networkErrors: pack?.networkErrors ?? [],
    pack: packPath,
    failureText: pack?.failure?.text ?? null,
    failureShot: pack?.failure?.screenshot ?? null,
    lastShot: pack?.lastScreenshot ?? null,
    runDir,
    testPath,
  };
}

function lastLine(s = '') {
  const lines = String(s).trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 300) : null;
}

/** kane-cli prints update notices on stderr; they are never the reason a run failed. */
export function stripNotices(s = '') {
  return String(s).split(/\r?\n/).filter((l) => !/update available|run `kane-cli install/i.test(l)).join('\n');
}

/**
 * Hard limit for one kane-cli process. Kane's own --timeout bounds each step, but start-up takes up to
 * ~3 minutes and recording a step takes 40-70 s, so a flat limit killed real multi-step recordings
 * mid-run. Scale with the journey's step count; replays of a recording are much faster.
 */
export function hardLimitS(kane = {}, journeyText = '', recorded = false) {
  const steps = Math.max(1, (String(journeyText).match(/^##\s+/gm) || []).length);
  const perStep = recorded ? 60 : 150;
  return Math.max((kane.timeout ?? 300) + 120, 240 + steps * perStep);
}

/** The pack path from the stderr hint, else the newest .evidence under the run dir. */
export function findPack(runDir, stderr = '') {
  const m = String(stderr).match(/evidence serve\s+([^`\r\n]+\.evidence)/);
  if (m && existsSync(m[1].trim())) return m[1].trim();
  const dir = path.join(runDir, '.testmuai', 'evidence');
  if (!existsSync(dir)) return null;
  const packs = readdirSync(dir)
    .filter((n) => n.endsWith('.evidence'))
    .map((n) => ({ p: path.join(dir, n), t: statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return packs.length ? packs[0].p : null;
}

/** Copy a run's fresh recording back into the seed so the other side replays it. */
export function adoptRecording(runResult, seedDir, journeyRel) {
  const stem = stemOf(journeyRel);
  const from = path.join(path.dirname(runResult.testPath), `output-${stem}`);
  const to = path.join(seedDir, path.dirname(journeyRel), `output-${stem}`);
  if (!existsSync(from)) return false;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  return true;
}

/** `kane-cli whoami` / `balance` (neither takes --agent), best effort. */
export async function kaneInfo() {
  const who = await run('kane-cli', ['whoami'], { timeoutMs: 30000 });
  const bal = await run('kane-cli', ['balance'], { timeoutMs: 30000 });
  const text = (r) => `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  return { whoami: text(who), whoamiCode: who.code, balance: text(bal), balanceCode: bal.code };
}
