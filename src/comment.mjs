// The PR comment: a three-light verdict table, Kane's evidence, and what happens next.
import { LIGHT, pickFailure } from './gate.mjs';
import { bumpLabel } from './deps.mjs';

export const MARKER = '<!-- bumpgate:v1 -->';

const VERDICT_TITLE = {
  green: 'Safe to merge',
  amber: 'Works, but the UI changed',
  red: 'Blocked: the app broke on this bump',
  inconclusive: 'On hold: Kane could not finish',
  fixed: 'Fixed and re-verified',
  'needs-human': 'Needs a human',
  running: 'Kane is checking this bump',
};

const ACTION_TEXT = {
  merge: 'Merging automatically.',
  review: 'Not auto-merged: one look from a maintainer, then merge.',
  block: 'Merge blocked.',
  hold: 'Not merged. Re-run the check, or look at the evidence below.',
};

function stateCell(runs, light, side) {
  if (!runs || !runs.length) return '–';
  const last = runs[runs.length - 1];
  const n = runs.length;
  const passes = runs.filter((r) => r.status === 'passed').length;
  const fails = runs.filter((r) => r.status === 'failed').length;
  const tally = n > 1 ? ` · ${side === 'bump' && light === 'red' ? fails : passes}/${n} runs` : '';
  if (side === 'base') {
    if (last.status === 'error' && passes === 0) return `⚠️ could not run${tally}`;
    return passes * 2 > n ? `✅ passed${tally}` : `❌ failed${tally}`;
  }
  if (light === 'red') {
    const f = runs.find((r) => r.status === 'failed' && r.failedStep);
    return `🔴 broke${f ? ` at step ${f.failedStep.index}` : ''}${tally}`;
  }
  if (light === 'amber') return `🟡 passed, changed${tally}`;
  if (light === 'green') return `🟢 passed${tally}`;
  if (last.status === 'error') return `⚪ could not run${tally}`;
  return `⚪ ignored${tally}`;
}

function kaneSays(row) {
  const d = row.decision;
  const failed = pickFailure(row.bump);
  if (d.light === 'red' && failed) {
    const bits = [];
    if (failed.failedStep?.heading) bits.push(`**${esc(failed.failedStep.heading)}**`);
    if (failed.bug?.title) bits.push(`${esc(failed.bug.title)}${failed.bug.severity ? ` (${esc(failed.bug.severity)})` : ''}`);
    else if (failed.reason) bits.push(esc(trim(failed.reason, 180)));
    // The hard evidence: an error that shows up only on the bump.
    const con = (d.newConsole || newConsoleFromRuns(row))[0];
    const cell = bits.join(': ') || esc(d.reasons.join(' '));
    return con ? `${cell} · new error on this bump: \`${esc(trim(con, 90)).replace(/`/g, "'")}\`` : cell;
  }
  return esc(d.reasons.join(' '));
}

export function renderComment(result, ctx = {}) {
  const v = ctx.state || result.verdict;
  const light = { green: LIGHT.green, amber: LIGHT.amber, red: LIGHT.red, inconclusive: LIGHT.grey, fixed: LIGHT.green, 'needs-human': LIGHT.red, running: '⏳' }[v];
  const label = bumpLabel(result.bumps || []);
  const lines = [MARKER];
  lines.push(`### ${light} Bumpgate · ${VERDICT_TITLE[v] || v}`);
  lines.push('');
  lines.push(`**\`${esc(label)}\`**  ·  CI checks that the code builds. **Kane CLI checked that the app still works**: ${result.rows.length} journey${result.rows.length === 1 ? '' : 's'} replayed in a real browser on base \`${(result.base || '').slice(0, 7)}\` and on this bump \`${(result.head || '').slice(0, 7)}\`.`);
  lines.push('');
  lines.push('| Journey | Base | This bump | Kane says |');
  lines.push('|---|---|---|---|');
  for (const row of result.rows) {
    lines.push(`| ${esc(row.journey.title)} | ${stateCell(row.base, row.decision.light, 'base')} | ${stateCell(row.bump, row.decision.light, 'bump')} | ${kaneSays(row)} |`);
  }
  lines.push('');
  const rule = result.rule || {};
  const ruleOk = rule.everyBasePassStillPasses && result.verdict !== 'inconclusive';
  const actionText = ctx.fix ? (ctx.fix.ok ? '' : ACTION_TEXT.block) : ACTION_TEXT[ctx.actionOverride || result.action] || '';
  lines.push(`**The rule (code, not a prompt):** every journey that passes on base must pass on the bump → ${ruleOk ? `✅ ${rule.comparable}/${rule.comparable} still pass` : result.verdict === 'inconclusive' ? '⚪ not provable' : `❌ ${result.counts.red} broke`}. ${actionText}`.trim());

  if (ctx.fix) lines.push('', ...renderFix(ctx.fix, ctx));
  if (result.notes?.length) {
    lines.push('');
    for (const n of result.notes) lines.push(`> ${esc(n)}`);
  }

  // The base-vs-bump screenshots are the proof a reviewer reads first, so they sit outside the fold.
  for (const row of result.rows) {
    const urls = ctx.shotUrls?.[row.journey.rel];
    if (!['red', 'amber'].includes(row.decision.light) || !(urls?.base || urls?.bump)) continue;
    const step = pickFailure(row.bump)?.failedStep?.heading;
    lines.push('', `**${esc(row.journey.title)}**${step ? ` · step "${esc(step)}"` : ''}`, '', '| Base (main) | This bump |', '|---|---|',
      `| ${urls.base ? `<img src="${urls.base}" width="400">` : '–'} | ${urls.bump ? `<img src="${urls.bump}" width="400">` : '–'} |`);
  }

  const evidence = renderEvidence(result, ctx);
  if (evidence.length) {
    lines.push('', '<details><summary><b>Evidence</b>: what Kane saw, console, network</summary>', '', ...evidence, '', '</details>');
  }
  lines.push('');
  const runs = result.kaneRuns != null ? `${result.kaneRuns} Kane runs` : '';
  lines.push(`<sub>${[runs, ctx.runUrl ? `[workflow run](${ctx.runUrl})` : '', 'Journeys come from the base branch, so a PR cannot edit its own exam', '[Bumpgate](https://github.com/Maheswar-Sah00/bumpgate) · verified with [Kane CLI](https://www.testmuai.com/kane-cli/) by TestMu AI'].filter(Boolean).join(' · ')}</sub>`);
  return lines.join('\n');
}

function renderFix(fix, ctx) {
  const out = [];
  const agent = fix.agentName || 'the agent';
  if (fix.ok) {
    out.push(`#### 🛠️ ${agent} migrated the code · ✅ Kane re-verified`);
  } else {
    out.push(`#### 🛠️ ${agent} tried ${fix.attempts.length} time${fix.attempts.length === 1 ? '' : 's'} · 🙋 needs a human`);
  }
  out.push('');
  out.push('| Attempt | What the agent did | Code checks | Kane re-run |');
  out.push('|---|---|---|---|');
  for (const a of fix.attempts) {
    const guard = a.rejected ? `❌ ${esc(a.rejected)}` : '✅ journeys untouched, bump kept';
    const kane = a.verdict ? `${LIGHT[a.verdict] || ''} ${a.verdict}${a.failedJourney ? `: ${esc(a.failedJourney)}` : ''}` : '–';
    out.push(`| ${a.n} | ${esc(trim(a.summary || '(no summary)', 220))} | ${guard} | ${kane} |`);
  }
  if (fix.ok && fix.result) {
    const r = fix.result;
    const n = r.rule?.comparable ?? r.rows.length;
    out.push('');
    out.push(`Kane re-ran all ${r.rows.length} journeys on the migrated code: ${r.verdict === 'green' ? `🟢 ${n}/${n} pass` : `🟡 ${n}/${n} pass, ${r.counts.amber} changed`}. ${ACTION_TEXT[ctx.actionOverride || r.action] || ''}`);
  }
  if (fix.ok && fix.commit) {
    out.push('');
    out.push(`Commit ${ctx.repo ? `[\`${fix.commit.slice(0, 7)}\`](https://github.com/${ctx.repo}/pull/${ctx.pr}/commits/${fix.commit})` : `\`${fix.commit.slice(0, 7)}\``} pushed to this PR (${fix.filesChanged?.length || 0} file${fix.filesChanged?.length === 1 ? '' : 's'}: ${(fix.filesChanged || []).slice(0, 5).map((f) => `\`${esc(f)}\``).join(', ')}).`);
  }
  if (fix.notesFrom?.length) out.push('', `<sub>Release notes read: ${fix.notesFrom.map((u) => `[${esc(shortUrl(u))}](${u})`).join(', ')}</sub>`);
  return out;
}

function renderEvidence(result, ctx) {
  const out = [];
  for (const row of result.rows) {
    if (!['red', 'amber'].includes(row.decision.light)) continue;
    out.push(`**${esc(row.journey.title)}**`);
    const d = row.decision;
    const failed = pickFailure(row.bump);
    // The deterministic fact first: the same recorded steps, replayed on both builds.
    if (d.light === 'red' && failed && failed.replayed > 0 && !failed.reauthored && row.base.some((r) => r.status === 'passed')) {
      out.push('', `Kane replayed the same recorded steps on both builds (${failed.replayed} replayed, none re-authored). They pass on base and fail on this bump, so the difference comes from the bump.`);
    }
    if (failed?.reason) {
      out.push('', `${failed.bug?.confirmed ? 'Kane (confirmed bug)' : 'Kane\'s investigation (unconfirmed)'}: _${esc(trim(failed.reason, 400))}_`);
    }
    // Kane's diagnosis is shown only for a confirmed bug: an unconfirmed one can blame the test.
    const diag = failed?.bug?.confirmed
      ? (failed.diagnosis || '').split(/\r?\n/).filter((l) => l.trim() && !/^evidence:/i.test(l.trim())).slice(0, 2).join(' ') : '';
    if (diag) out.push('', `Kane's diagnosis: ${esc(trim(diag, 400))}`);
    const con = d.newConsole || newConsoleFromRuns(row);
    if (con.length) {
      out.push('', 'New console errors on the bump:', '```', ...con.slice(0, 6).map((c) => trim(c, 200)), '```');
    }
    const net = d.newNetwork || [];
    if (net.length) out.push('', 'New failed requests:', '```', ...net.slice(0, 6), '```');
    const packs = ctx.packUrls?.[row.journey.rel];
    if (packs) {
      out.push('', `Kane evidence packs: ${Object.entries(packs).map(([side, u]) => `[${side}](${u})`).join(' · ')}`);
    }
    out.push('');
  }
  return out;
}

function newConsoleFromRuns(row) {
  const base = new Set(row.base.flatMap((r) => r.consoleErrors || []));
  return [...new Set(row.bump.flatMap((r) => r.consoleErrors || []))].filter((c) => !base.has(c));
}

export function renderRunning({ bumps = [], journeys = [], base, head }) {
  return [
    MARKER,
    '### ⏳ Bumpgate · Kane is checking this bump',
    '',
    `**\`${esc(bumpLabel(bumps))}\`**: replaying ${journeys.length} journey${journeys.length === 1 ? '' : 's'} in a real browser on base \`${(base || '').slice(0, 7)}\` and on this bump \`${(head || '').slice(0, 7)}\`.`,
    '',
    ...journeys.map((j) => `- ${esc(j.title)}`),
  ].join('\n');
}

/** One line for the terminal and the Action summary title. */
export function oneLine(result) {
  return `${{ green: '🟢', amber: '🟡', red: '🔴', inconclusive: '⚪' }[result.verdict]} ${result.headline} · ${bumpLabel(result.bumps || [])}`;
}

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/</g, '&lt;');
}

function trim(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function shortUrl(u) {
  return String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/^github\.com\//, '').slice(0, 60);
}
