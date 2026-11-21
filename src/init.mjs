// bumpgate init: draft the app's critical journeys, then keep only the ones Kane passes on this commit.
// The agent proposes; Kane decides; nothing is kept that has not passed in a real browser.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.mjs';
import { buildSide, serveSide } from './workspace.mjs';
import { runJourney, makeBudget, stemOf } from './kane.mjs';
import { runAgent } from './agent.mjs';
import { listJourneys } from './check.mjs';

export function initTask({ count, journeysDir, url }) {
  return [
    '# Task: write this web app\'s critical user journeys as Kane CLI tests',
    '',
    `Read the app's source and write the ${count} most important user journeys as plain-English Kane CLI test files in \`${journeysDir}/\`.`,
    'These journeys guard every dependency upgrade: a bump may merge only if every journey still passes, so pick the flows whose',
    'breakage would hurt users most (buying, signing up, searching, saving, the main form).',
    '',
    'Format of each file (`<name>_test.md`, lowercase, underscores):',
    '',
    '```markdown',
    '---',
    'mode: testing',
    'max_steps: 25',
    '---',
    '',
    '# One-line title of the journey',
    '',
    '## First step heading',
    'What to do, in plain English, naming visible labels in quotes.',
    '',
    '## Second step heading',
    'What to do.',
    'Verify <something specific and visible, e.g. the text "Order confirmed">.',
    '```',
    '',
    'Rules:',
    `- The test starts on the app's home page (${url}); do not write URLs or ports in the steps.`,
    '- 2 to 5 steps per journey. Every journey ends with a concrete "Verify ..." line about text a user can see.',
    '- No login walls, payments, emails, captchas or third-party sites. No random data: use fixed example values.',
    '- Describe behaviour, not CSS selectors or test ids, so the journey survives UI refactors.',
    '- Include at least one journey that checks an error or edge case the user would see (e.g. a form validation message).',
    `- Only create files inside \`${journeysDir}/\`. Do not change any other file.`,
    '',
    'When done, reply with one line per journey: its file name and why it matters.',
  ].join('\n');
}

export async function init(args, overrides, log) {
  const repoDir = path.resolve(args.repo || '.');
  const cfg = loadConfig(repoDir, overrides);
  const count = Number(args.count || 3);
  const journeysDir = path.join(repoDir, cfg.journeys);
  const appDir = path.join(repoDir, cfg.appDir || '');
  const agent = cfg.agent === 'none' ? null : cfg.agent;
  const outDir = path.join(repoDir, '.bumpgate', 'init');
  mkdirSync(outDir, { recursive: true });

  log.step('Building the app on this commit');
  const build = await buildSide(appDir, cfg, { onLog: (s) => log.dim(s), skipInstall: existsSync(path.join(appDir, 'node_modules')) });
  if (!build.ok) throw new Error(`the app does not ${build.step}:\n${build.log}`);
  const port = cfg.port || 4319;
  const url = `http://localhost:${port}/`;

  const before = new Set(listJourneys(journeysDir).map((j) => j.rel));
  if (agent && !args.skipAgent) {
    mkdirSync(journeysDir, { recursive: true });
    const taskDir = path.join(outDir, 'task');
    mkdirSync(taskDir, { recursive: true });
    const taskFile = path.join(taskDir, 'task.md');
    writeFileSync(taskFile, initTask({ count, journeysDir: cfg.journeys, url }));
    log.step(`${agent === 'codex' ? 'Codex' : 'Claude Code'} is reading the app and drafting ${count} journeys`);
    const res = await runAgent(agent, { cwd: repoDir, taskFile, outDir, attempt: 'init' });
    if (res.summary) log.info(res.summary.split('\n').slice(0, count + 2).join('\n'));
  }
  const drafted = listJourneys(journeysDir).filter((j) => !before.has(j.rel) || args.all);
  if (!drafted.length) {
    log.warn(`No new journeys in ${cfg.journeys}/. Write some *_test.md files there, or run with --agent codex|claude.`);
    return 1;
  }

  const server = await serveSide(appDir, build.commands, port);
  log.step(`Kane is recording ${drafted.length} journeys on ${server.url}`);
  const budget = makeBudget(cfg.kane.maxRuns);
  const kept = [];
  const dropped = [];
  try {
    for (const j of drafted) {
      const runDir = path.join(os.tmpdir(), 'bumpgate-init', stemOf(j.rel));
      const res = await runJourney({ journeyRel: j.rel, seedDir: journeysDir, runDir, url: server.url, label: `init:${stemOf(j.rel)}`, kane: cfg.kane, budget });
      if (res.status === 'passed') {
        // Keep the recording next to the journey so CI replays it instead of re-authoring.
        const from = path.join(path.dirname(res.testPath), `output-${stemOf(j.rel)}`);
        const to = path.join(journeysDir, path.dirname(j.rel), `output-${stemOf(j.rel)}`);
        if (existsSync(from)) { rmSync(to, { recursive: true, force: true }); cpSync(from, to, { recursive: true }); }
        kept.push(j);
        log.ok(`kept: ${j.title}`);
      } else {
        dropped.push({ j, why: res.reason || res.status });
        const parked = path.join(journeysDir, '_drafts');
        mkdirSync(parked, { recursive: true });
        writeFileSync(path.join(parked, path.basename(j.rel).replace(/_test\.md$/, '.draft.md')), j.text);
        rmSync(path.join(journeysDir, j.rel), { force: true });
        log.fail(`dropped (Kane could not pass it on this commit): ${j.title}: ${res.reason || res.status}`);
      }
    }
  } finally {
    await server.stop();
  }
  log.raw('');
  log.raw(`${kept.length} journey${kept.length === 1 ? '' : 's'} recorded in ${cfg.journeys}/ (commit them, with their output-*/ folders).`);
  if (dropped.length) log.raw(`${dropped.length} parked in ${cfg.journeys}/_drafts/ for a human to fix.`);
  return kept.length ? 0 : 1;
}
