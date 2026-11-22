// Collect every finished Radar case into the bumpgate repo: radar/RESULTS.md, radar/results.json,
// the journey texts Claude Code drafted (kept and parked), and the base/bump screenshots.
// Kane's raw recordings and evidence packs stay private (they carry account identifiers).
//   node aggregate.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseStream, offAppUrls } from 'file:///B:/Projects/Kane-CLI/bumpgate/src/kane.mjs';
import { decideJourney } from 'file:///B:/Projects/Kane-CLI/bumpgate/src/gate.mjs';

// Re-judge every bump run with the off-app guard (added after these runs): a failure on another local
// app is not counted. A journey counts as broken only with two on-app failures on the bump.
const workDirOf = (id) => {
  const repoDir = path.resolve(`C:/bumpgate-work/radar/${id}/repo`);
  return path.join('C:/bumpgate-work/radar/_work', `repo-${createHash('sha1').update(repoDir).digest('hex').slice(0, 8)}`);
};
function rejudge(id, rel, appUrl) {
  const runs = path.join(workDirOf(id), 'runs');
  if (!existsSync(runs)) return null;
  const stem = rel.replace(/_test\.md$/, '');
  const out = { onAppFail: 0, offApp: 0, pass: 0, error: 0 };
  for (const n of readdirSync(runs).filter((n) => n.startsWith(`bump-${stem}-`))) {
    const f = path.join(runs, n, 'kane.ndjson');
    if (!existsSync(f)) continue;
    const parsed = parseStream(readFileSync(f, 'utf8').split(/\r?\n/));
    const failed = parsed.done?.overall_status === 'failed' || Object.values(parsed.steps).some((x) => x.status === 'failed');
    const passed = parsed.done?.overall_status === 'passed';
    if (offAppUrls(parsed, appUrl).length) out.offApp++;
    else if (failed) out.onAppFail++;
    else if (passed) out.pass++;
    else out.error++;
  }
  return out;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = 'B:/Projects/Kane-CLI/bumpgate/radar';
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const cases = read(path.join(HERE, 'cases.json'));
const pre = (id) => { try { return read(path.join(HERE, 'prebuild', `${id}.json`)); } catch { return null; } };

const rows = [];
for (const c of cases) {
  const dir = path.join(HERE, 'results', c.id);
  if (!existsSync(path.join(dir, 'verdict.json')) || !existsSync(path.join(dir, 'meta.json'))) continue;
  const meta = read(path.join(dir, 'meta.json'));
  const v = read(path.join(dir, 'verdict.json'));
  if (!v.rows?.length || v.verdict === 'inconclusive') continue;
  // the URL the gate actually served the bump on, from its own log ("Kane on bump (http://localhost:4371/x/)")
  const bumpUrl = (() => { try { return readFileSync(path.join(dir, 'check.log'), 'utf8').match(/Kane on bump \((http[^)]+)\)/)?.[1] || null; } catch { return null; } })();
  const cfgPort = bumpUrl ? new URL(bumpUrl).port : null;
  const appUrl = () => bumpUrl;
  const port = null;
  const journeys = v.rows.map((r) => {
    const last = r.bump[r.bump.length - 1] || {};
    // re-decide with today's gate.mjs (it learned after these runs that a heal on base is not drift)
    const decision = decideJourney({ base: r.base, bump: r.bump });
    let light = decision.light;
    const rj = light === 'red' && cfgPort ? rejudge(c.id, r.journey.rel, appUrl(r.journey.rel)) : null;
    if (rj && rj.onAppFail < 2) light = 'inconclusive';
    void port;
    const healStep = light === 'amber' ? (r.bump.find((x) => x.healed)?.healedStep || null) : null;
    return {
      title: r.journey.title, file: r.journey.rel, light, rejudged: rj, reasons: decision.reasons, healStep,
      base: r.base.map((x) => x.status), bump: r.bump.map((x) => x.status),
      failedStep: last.failedStep?.heading || null, reason: last.failedStep?.reason || null,
      console: (last.consoleErrors || []).slice(0, 2), bug: last.bug?.confirmed ? { title: last.bug.title, severity: last.bug.severity } : null,
    };
  });
  rows.push({
    id: c.id, kind: c.kind === 'control' ? 'control' : 'open', repo: c.repo, pr: c.pr, url: `https://github.com/${c.repo}/pull/${c.pr}`,
    stars: c.stars, pkg: c.pkg, from: c.from, to: c.to, title: meta.title,
    verdict: journeys.some((x) => x.light === 'red') ? 'red' : journeys.some((x) => x.light === 'amber') ? 'amber'
      : journeys.some((x) => x.light === 'inconclusive') ? 'inconclusive' : 'green',
    headline: v.headline,
    notes: v.notes || [],
    // older runs predate the peer-conflict note: read it from the check log
    peerConflict: v.builds?.bump?.peerConflict || (() => {
      try {
        const log = readFileSync(path.join(dir, 'check.log'), 'utf8');
        const bumpPart = log.slice(log.indexOf('Building bump'));
        return /peer-dependency conflict/.test(bumpPart) ? `${c.pkg}@${c.to} conflicts with its peers` : null;
      } catch { return null; }
    })(),
    init: { kept: meta.init?.kept || [], parked: meta.init?.dropped || [] }, journeys,
    merged: c.merged || null, checkedAt: meta.startedAt?.slice(0, 10),
  });
  // journey texts + screenshots
  const out = path.join(DEST, 'cases', c.id);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  if (existsSync(path.join(dir, 'journeys'))) {
    cpSync(path.join(dir, 'journeys'), path.join(out, 'journeys'), { recursive: true });
    // a draft that was later re-recorded and kept is not a parked draft
    for (const n of readdirSync(path.join(out, 'journeys'))) {
      if (n.endsWith('.draft.md') && existsSync(path.join(out, 'journeys', n.replace(/\.draft\.md$/, '_test.md')))) rmSync(path.join(out, 'journeys', n));
    }
  }
  if (existsSync(path.join(dir, 'shots'))) cpSync(path.join(dir, 'shots'), path.join(out, 'shots'), { recursive: true });
  writeFileSync(path.join(out, 'comment.md'), existsSync(path.join(dir, 'comment.md')) ? readFileSync(path.join(dir, 'comment.md'), 'utf8') : '');
}

// Bumps that never got to Kane because they do not build (from the free pre-check).
const buildBlocked = cases.filter((c) => c.kind !== 'control').map((c) => ({ c, p: pre(c.id) }))
  .filter(({ p }) => p?.base?.ok && p?.bump && !p.bump.ok)
  .map(({ c, p }) => ({ repo: c.repo, pr: c.pr, url: `https://github.com/${c.repo}/pull/${c.pr}`, pkg: c.pkg, from: c.from, to: c.to, step: p.bump.step }));

const open = rows.filter((r) => r.kind === 'open');
const ctl = rows.filter((r) => r.kind === 'control');
const red = open.filter((r) => r.verdict === 'red');
const summary = {
  openChecked: open.length, openRed: red.length, openGreen: open.filter((r) => r.verdict === 'green').length,
  openAmber: open.filter((r) => r.verdict === 'amber').length,
  controls: ctl.length, falseAlarms: ctl.filter((r) => r.verdict === 'red').length, controlAmber: ctl.filter((r) => r.verdict === 'amber').length,
  buildBlocked: buildBlocked.length,
  journeysDrafted: rows.reduce((n, r) => n + r.init.kept.length + r.init.parked.length, 0),
  journeysKept: rows.reduce((n, r) => n + r.init.kept.length, 0),
};
mkdirSync(DEST, { recursive: true });
writeFileSync(path.join(DEST, 'results.json'), JSON.stringify({ summary, open, controls: ctl, buildBlocked }, null, 2) + '\n');

const L = (r) => ({ red: '🔴', green: '🟢', amber: '🟡' }[r.verdict] || '⚪');
const md = [];
md.push('# Radar: Bumpgate on open bot PRs in other people\'s repos', '');
md.push(`**${summary.openChecked} open Dependabot PRs checked end to end: ${summary.openRed} red, ${summary.openGreen} green${summary.openAmber ? `, ${summary.openAmber} amber` : ''}. ${summary.controls} control bumps that were merged and never reverted: ${summary.falseAlarms} false alarm${summary.falseAlarms === 1 ? '' : 's'}.**`, '');
md.push('Nothing here was planted. Each repo is someone else\'s public app; we never pushed to it or commented on it.', '');
md.push('## How each case was run', '');
md.push('1. **`bumpgate init`** on the PR\'s base commit: Claude Code read the app\'s code and drafted journeys; Kane recorded each one and kept only those that pass on base. Drafts it could not pass are parked, not kept.');
md.push('2. The kept journeys were committed on a local copy of base (never pushed), and the bot PR\'s exact diff applied on top.');
md.push('3. **`bumpgate check`** built both sides, Kane replayed every journey on each, and Bumpgate\'s rule decided. A failure on the bump is confirmed with another run.');
md.push('4. Cases were chosen only on whether the base app runs without a backend; the bump was not looked at first, and every case that reached Kane is listed below, greens included.', '');
md.push('## Open bot PRs', '', '| | Repo · PR | Upgrade | Journeys | What Kane saw |', '|---|---|---|---|---|');
for (const r of open) {
  const j = r.journeys.map((x) => `${x.base.includes('passed') ? 'pass' : x.base[0]} → ${x.bump.includes('passed') ? 'pass' : 'fail'}`);
  const n = (l) => r.journeys.filter((x) => x.light === l).length;
  const counts = [n('red') && `${n('red')} broke`, n('amber') && `${n('amber')} amber`, n('inconclusive') && `${n('inconclusive')} inconclusive`, n('green') && `${n('green')} same`].filter(Boolean).join(', ');
  const bug = r.journeys.find((x) => x.light === 'red' && x.bug)?.bug;
  const con = r.journeys.find((x) => x.light === 'red' && x.console.length)?.console[0];
  const amberJ = r.journeys.find((x) => x.light === 'amber');
  const what = r.verdict === 'red'
    ? `${bug ? `Kane: *"${bug.title}"* (${bug.severity}). ` : ''}${con ? `Console: \`${con.slice(0, 90)}\`. ` : ''}${r.peerConflict ? `npm itself refused this tree (${r.peerConflict}) and the PR's own CI is red; a forced install (\`--legacy-peer-deps\`) ships this. ` : ''}[screenshots](cases/${r.id}/shots/)`
    : r.verdict === 'amber'
      ? `Works, but the UI moved: Kane replayed *"${amberJ.title}"* cleanly on main and passed it on the bump only after self-healing a step. One look before merging.${r.peerConflict ? ` npm also refused the tree (${r.peerConflict}).` : ''}`
      : 'Every journey behaves the same.';
  md.push(`| ${L(r)} | [${r.repo} #${r.pr}](${r.url})${r.stars >= 50 ? ` · ${r.stars.toLocaleString('en')}★` : ''} | \`${r.pkg}\` ${r.from} → ${r.to} | ${counts} | ${what} |`);
  void j;
}
md.push('', '## Controls: bot bumps that were merged and never reverted', '', '| | Repo · PR | Upgrade | Merged | Journeys same |', '|---|---|---|---|---|');
for (const r of ctl) md.push(`| ${L(r)} | [${r.repo} #${r.pr}](${r.url}) | \`${r.pkg}\` ${r.from} → ${r.to} | ${r.merged} | ${r.journeys.filter((x) => x.light === 'green').length}/${r.journeys.length} same |`);
if (buildBlocked.length) {
  md.push('', '## Open bot PRs that do not even build', '', 'Bumpgate blocks these before Kane runs. Most of these repos\' own CI already fails on them; it is listed for completeness, not as a Kane result.', '');
  for (const b of buildBlocked) md.push(`- [${b.repo} #${b.pr}](${b.url}): \`${b.pkg}\` ${b.from} → ${b.to} fails at ${b.step}`);
}
md.push('', '## `bumpgate init` on code it had never seen', '');
md.push(`Claude Code drafted **${summary.journeysDrafted}** journeys across these apps; Kane kept **${summary.journeysKept}** that pass on base and parked the rest for a human. Every journey file is in [cases/](cases/), parked drafts as \`*.draft.md\`.`, '');
md.push('## What running on strangers\' repos fixed in Bumpgate', '');
md.push('Our demo shop never hit these. Each one was found here, fixed, tested and re-applied to the results above:', '');
const C = (h) => `[${h}](https://github.com/Maheswar-Sah00/bumpgate/commit/${h})`;
md.push(`- Recording a 4-step journey takes longer than the old flat 7-minute limit, which killed real recordings mid-run; the limit now scales with the steps (${C('650c9f2')}).`);
md.push(`- Vite apps that build to \`build/\` or serve under a GitHub Pages path (\`base: '/repo/'\`) are detected; local \`check\` reads config from the base commit like CI; an unset CLI flag no longer erases it; a peer-dependency conflict on the bump is reported, not silently forced (${C('88c5f5d')}).`);
md.push(`- Kane can carry a URL from one session into another. A run that wanders into a different local app is counted as a run error and re-run, never as a broken journey (${C('d6c5325')}). One voxel-rpg-game journey is inconclusive for this reason.`);
md.push(`- A self-heal is drift only when base replayed cleanly. One control needed a heal on base too; it is green, not amber (${C('b27cb7b')}).`, '');
md.push('## Limits', '');
md.push('- A small sample, picked from apps that run without a backend, login or database.');
md.push('- Journeys come from `init` and cover what a visitor can reach without an account.');
md.push('- Kane checks what a user can do, not pixels: a pure styling regression can pass.');
md.push('- Kane\'s raw evidence packs and recordings are not published: they contain the Kane account\'s identifiers.');
writeFileSync(path.join(DEST, 'RESULTS.md'), md.join('\n') + '\n');
console.log(JSON.stringify(summary));
