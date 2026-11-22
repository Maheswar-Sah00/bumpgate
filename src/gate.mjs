// The merge rule. Pure code, no model in the loop:
//   a bump may merge only if every journey that passes on base also passes on the bump.
// A journey that fails on base cannot block (it is flagged instead).
// Anything Kane could not run fails closed: no auto-merge.

/** @typedef {'passed'|'failed'|'error'} RunStatus */

/**
 * Majority over repeated runs of one journey on one side.
 * @param {{status: RunStatus}[]} runs
 * @returns {'pass'|'fail'|'flaky'|'error'|'none'}
 */
export function majority(runs) {
  if (!runs || runs.length === 0) return 'none';
  const pass = runs.filter((r) => r.status === 'passed').length;
  const fail = runs.filter((r) => r.status === 'failed').length;
  if (pass === 0 && fail === 0) return 'error';
  if (pass > fail) return 'pass';
  if (fail > pass) return 'fail';
  return 'flaky';
}

/**
 * Messages that appear only on the bump side. Hashes, ports, line:col and query strings
 * are normalised away so a rebuilt bundle name does not count as a new error.
 */
export function newOnBump(baseList = [], bumpList = []) {
  const seen = new Set(baseList.map(normaliseMessage));
  const out = [];
  const added = new Set();
  for (const m of bumpList) {
    const k = normaliseMessage(m);
    if (!seen.has(k) && !added.has(k)) {
      added.add(k);
      out.push(m);
    }
  }
  return out;
}

export function normaliseMessage(m) {
  return String(m)
    .replace(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+/g, 'http://host')
    .replace(/[-.][A-Za-z0-9_]{8,}\.(js|mjs|css|map)\b/g, '.$1')
    .replace(/:\d+:\d+/g, '')
    .replace(/\?[^\s'")]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function flatten(runs, key) {
  return runs.flatMap((r) => (Array.isArray(r[key]) ? r[key] : []));
}

/** Items (after `map`) present in every run's `key` list. One run: that run's list. */
function seenInEvery(runs, key, map = (x) => x) {
  if (!runs.length) return [];
  const list = (r) => (Array.isArray(r[key]) ? r[key] : []).map(map);
  const sets = runs.map((r) => new Set(list(r).map(normaliseMessage)));
  return list(runs[0]).filter((m) => sets.every((s) => s.has(normaliseMessage(m))));
}

/**
 * Decide one journey.
 * @returns {{light:'green'|'amber'|'red'|'grey', kind:string, base:string, bump:string, blocks:boolean, holds:boolean, reasons:string[]}}
 */
export function decideJourney({ base = [], bump = [] }) {
  const b = majority(base);
  const h = majority(bump);
  const reasons = [];

  if (b === 'error' || b === 'none') {
    return { light: 'grey', kind: 'base-error', base: b, bump: h, blocks: false, holds: true,
      reasons: ['Kane could not run this journey on base, so nothing can be compared (fail closed).'] };
  }
  if (b === 'fail') {
    return { light: 'grey', kind: 'base-broken', base: b, bump: h, blocks: false, holds: false,
      reasons: ['Already fails on base. Ignored so it cannot block the bump; fix it on main.'] };
  }
  if (b === 'flaky') {
    return { light: 'grey', kind: 'base-flaky', base: b, bump: h, blocks: false, holds: false,
      reasons: ['Flaky on base (runs disagree). Ignored so it cannot block the bump.'] };
  }

  // Base passes: the bump must pass too.
  if (h === 'error' || h === 'none') {
    return { light: 'grey', kind: 'bump-error', base: b, bump: h, blocks: false, holds: true,
      reasons: ['Kane could not run this journey on the bump (fail closed: no auto-merge).'] };
  }
  if (h === 'fail') {
    return { light: 'red', kind: 'regression', base: b, bump: h, blocks: true, holds: true,
      reasons: ['Passes on base, fails on the bump.'] };
  }
  if (h === 'flaky') {
    reasons.push('Runs on the bump disagree (flaky after the bump).');
    return { light: 'amber', kind: 'bump-flaky', base: b, bump: h, blocks: false, holds: false, reasons };
  }

  const passing = bump.filter((r) => r.status === 'passed');
  const healed = passing.some((r) => r.healed);
  // A new error must show up in every passing bump run: one flaky third-party request is not drift.
  const newConsole = newOnBump(flatten(base, 'consoleErrors'), seenInEvery(passing, 'consoleErrors'));
  const newNetwork = newOnBump(
    flatten(base, 'networkErrors').map(netKey),
    seenInEvery(passing, 'networkErrors', netKey),
  );
  if (healed) reasons.push('Passed only after Kane self-healed a step: the UI changed under the same journey.');
  if (newConsole.length) reasons.push(`${newConsole.length} new console error(s) on the bump.`);
  if (newNetwork.length) reasons.push(`${newNetwork.length} new failed request(s) on the bump.`);
  if (reasons.length) {
    return { light: 'amber', kind: 'drift', base: b, bump: h, blocks: false, holds: false, reasons,
      newConsole, newNetwork, healed };
  }
  return { light: 'green', kind: 'same', base: b, bump: h, blocks: false, holds: false,
    reasons: ['Same journey, same result.'] };
}

// Compare requests by shape, not by ids: map tiles (/tile/11/758/972), record ids and content hashes
// differ from run to run even when the app behaves the same.
export function netKey(n) {
  if (typeof n === 'string') return n;
  const url = String(n.url || '').replace(/[?#].*$/, '')
    .replace(/\/\d+(?=[/._]|$)/g, '/N')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/H');
  return `${n.status} ${n.method || 'GET'} ${url}`;
}

/**
 * Decide the whole bump.
 * @param {{journey:{name:string}, base:any[], bump:any[]}[]} rows
 * @param {{amber?: 'review'|'merge'|'block'}} opts
 */
export function decide(rows, { amber = 'review' } = {}) {
  const decided = rows.map((r) => ({ ...r, decision: decideJourney(r) }));
  const lights = decided.map((r) => r.decision.light);
  const red = decided.filter((r) => r.decision.light === 'red');
  const held = decided.filter((r) => r.decision.holds && r.decision.light !== 'red');
  const comparable = decided.filter((r) => r.decision.base === 'pass');
  const ambers = decided.filter((r) => r.decision.light === 'amber');

  let verdict;
  let action;
  let headline;
  if (red.length) {
    verdict = 'red';
    action = 'block';
    headline = `${red.length} journey${red.length > 1 ? 's' : ''} broke on the bump`;
  } else if (held.length || comparable.length === 0) {
    verdict = 'inconclusive';
    action = 'hold';
    headline = comparable.length === 0
      ? 'No journey passes on base, so there is nothing to compare'
      : `Kane could not finish ${held.length} journey${held.length > 1 ? 's' : ''}`;
  } else if (ambers.length) {
    verdict = 'amber';
    action = amber === 'merge' ? 'merge' : amber === 'block' ? 'block' : 'review';
    headline = `Works, but ${ambers.length} journey${ambers.length > 1 ? 's' : ''} changed`;
  } else {
    verdict = 'green';
    action = 'merge';
    headline = `All ${comparable.length} journeys behave the same`;
  }

  // The rule itself, stated as a boolean that tests can pin down.
  const everyBasePassStillPasses = comparable.every((r) => ['green', 'amber'].includes(r.decision.light));

  return {
    verdict,
    action,
    headline,
    mergeable: verdict === 'green' || (verdict === 'amber' && action === 'merge'),
    rule: { everyBasePassStillPasses, comparable: comparable.length, total: rows.length },
    counts: {
      green: lights.filter((l) => l === 'green').length,
      amber: lights.filter((l) => l === 'amber').length,
      red: lights.filter((l) => l === 'red').length,
      grey: lights.filter((l) => l === 'grey').length,
    },
    rows: decided,
  };
}

/**
 * Should we re-run to confirm? Only when the first runs disagree across sides,
 * so a clean green costs one run per side.
 */
export function needsConfirmation({ base = [], bump = [] }, confirmRuns = 3) {
  const b = majority(base);
  const h = majority(bump);
  const settled = Math.floor(confirmRuns / 2) + 1; // e.g. 2 of 3: one more run cannot flip it
  const bumpFails = bump.filter((r) => r.status === 'failed').length;
  const bumpPasses = bump.filter((r) => r.status === 'passed').length;
  if (b === 'pass' && (bumpFails >= settled || bumpPasses >= settled)) return null;
  if (b === 'pass' && (h === 'fail' || h === 'flaky' || h === 'error') && bump.length < confirmRuns) return 'bump';
  // Amber from new errors alone, seen in a single passing run: replay once more (free when it passes)
  // so a flaky third-party request does not hold a safe bump. A self-heal needs no second run.
  if (b === 'pass' && h === 'pass' && bumpPasses < 2 && bump.length < confirmRuns) {
    const d = decideJourney({ base, bump });
    if (d.light === 'amber' && d.kind === 'drift' && !d.healed) return 'bump';
  }
  if (b !== 'pass' && h === 'pass' && base.length < Math.min(2, confirmRuns)) return 'base';
  if (b === 'error' && base.length < 2) return 'base';
  return null;
}

export const LIGHT = { green: '🟢', amber: '🟡', red: '🔴', grey: '⚪' };

const SEVERITY = { blocker: 4, critical: 4, major: 3, high: 3, medium: 2, moderate: 2, minor: 1, low: 1, trivial: 0 };

/**
 * The failed run that explains a breakage best: a confirmed Kane bug first, then the most severe,
 * then the most confident, then the latest. Kane's after-the-fact story can differ between two
 * runs of the same failure; the gate never depends on it, but the comment should show the best one.
 */
export function pickFailure(runs = []) {
  const failed = runs.map((r, i) => ({ r, i })).filter(({ r }) => r && r.status === 'failed');
  if (!failed.length) return null;
  const sev = (r) => SEVERITY[String(r.bug?.severity || '').toLowerCase()] ?? -1;
  failed.sort((a, b) => (b.r.bug?.confirmed ? 1 : 0) - (a.r.bug?.confirmed ? 1 : 0)
    || sev(b.r) - sev(a.r) || (b.r.bug?.confidence ?? 0) - (a.r.bug?.confidence ?? 0) || b.i - a.i);
  return failed[0].r;
}
