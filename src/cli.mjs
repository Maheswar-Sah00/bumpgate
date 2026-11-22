import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger, color, lightText } from './log.mjs';
import { loadConfig } from './config.mjs';
import { Session } from './check.mjs';
import { fixLoop } from './fix.mjs';
import { renderComment, oneLine } from './comment.mjs';
import { ci } from './ci.mjs';
import { kaneInfo } from './kane.mjs';
import { run, gitOk } from './sh.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version;

const HELP = `
${color.bold('bumpgate')} ${VERSION}. Dependabot says CI is green. Kane CLI checks the app still works.

  bumpgate check [--base <ref>] [--head <ref>]   Replay every journey on base and on the bump
        [--title "<PR title>"] [--fix] [--agent codex|claude|none]
        [--out <dir>] [--headed] [--amber review|merge|block]
  bumpgate init [--agent codex|claude] [--count 3]  Write the app's top journeys, keep the ones Kane passes on main
  bumpgate ci                                     GitHub Action entry (bot PRs only)
  bumpgate backtest <cases.json> [--only <id>]    Replay real reverted bumps (the headline number)
  bumpgate comment <verdict.json>                 Print the PR comment for a saved verdict
  bumpgate doctor                                 Check kane-cli, login, Chrome, git and the agent

  The rule, in code: a bump merges only if every journey that passes on base also passes on the bump.
  Journeys are plain-English Kane tests in .kane/*_test.md, always read from the base branch.
`;

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (eq > 0) args[key] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (args.version || cmd === 'version') {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  if (!cmd || args.help || cmd === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const log = makeLogger({ json: !!args.json });
  const overrides = {
    agent: args.agent,
    amber: args.amber,
    journeys: args.journeys,
    port: args.port ? Number(args.port) : undefined,
    kane: { ...(args.headed ? { headed: true } : {}), ...(args.maxRuns ? { maxRuns: Number(args.maxRuns) } : {}) },
  };

  switch (cmd) {
    case 'check': return check(args, overrides, log);
    case 'ci': return ci({ log, overrides });
    case 'comment': {
      const file = args._[1] || '.bumpgate/verdict.json';
      const result = JSON.parse(readFileSync(file, 'utf8'));
      process.stdout.write(renderComment(result, {}) + '\n');
      return 0;
    }
    case 'doctor': return doctor(log);
    case 'init': {
      const { init } = await import('./init.mjs');
      return init(args, overrides, log);
    }
    case 'backtest': {
      const { backtest } = await import('./backtest.mjs');
      return backtest(args, overrides, log);
    }
    default:
      process.stderr.write(`unknown command "${cmd}"\n${HELP}`);
      return 2;
  }
}

async function check(args, overrides, log) {
  const repoDir = path.resolve(args.repo || '.');
  const head = args.head || 'HEAD';
  const base = args.base || defaultBase(repoDir, head);
  // Same as CI: config comes from the base commit, so a bump cannot loosen its own gate.
  const { configAtBase } = await import('./ci.mjs');
  const baseSha = gitOk(['rev-parse', '--verify', `${base}^{commit}`], repoDir);
  const cfg = baseSha.ok ? configAtBase(repoDir, baseSha.out.trim(), overrides) : loadConfig(repoDir, overrides);
  const outDir = path.resolve(args.out || path.join(repoDir, '.bumpgate'));
  const title = args.title || gitOk(['log', '-1', '--format=%s', head], repoDir).out;
  const session = new Session({ repoDir, base, head, title, cfg, outDir, log });
  session.prepare();
  let result = await session.compare();
  printTable(result, log);

  let fix = null;
  if (args.fix && result.verdict === 'red' && cfg.agent !== 'none') {
    fix = await fixLoop(session, { agent: cfg.agent, maxAttempts: cfg.maxFixAttempts, log });
    if (fix.ok) printTable(fix.result, log);
    writeFileSync(path.join(outDir, 'fix.json'), JSON.stringify({ ...fix, result: undefined }, null, 2));
  }
  const state = fix ? (fix.ok ? 'fixed' : 'needs-human') : result.verdict;
  const body = renderComment(result, { state, fix });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'comment.md'), body);
  log.raw('');
  log.raw(color.bold(oneLine(fix?.ok ? fix.result : result)));
  log.raw(color.dim(`verdict → ${path.relative(process.cwd(), path.join(outDir, 'verdict.json'))} · comment → ${path.relative(process.cwd(), path.join(outDir, 'comment.md'))}`));
  if (args.json) process.stdout.write(JSON.stringify({ state, verdict: result.verdict, headline: result.headline, fix: fix ? { ok: fix.ok, commit: fix.commit, attempts: fix.attempts.length } : null }) + '\n');
  return { green: 0, fixed: 0, amber: 10, red: 1, 'needs-human': 1, inconclusive: 3 }[state] ?? 1;
}

function defaultBase(repoDir, head) {
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    const r = gitOk(['merge-base', ref, head], repoDir);
    if (r.ok && r.out) {
      const headSha = gitOk(['rev-parse', head], repoDir).out;
      if (r.out !== headSha) return r.out;
    }
  }
  return `${head}~1`;
}

function printTable(result, log) {
  log.raw('');
  const w = Math.max(10, ...result.rows.map((r) => r.journey.title.length));
  log.raw(color.bold(`  ${'Journey'.padEnd(w)}  Base      Bump      Light`));
  for (const r of result.rows) {
    const b = r.decision.base;
    const h = r.decision.bump;
    log.raw(`  ${r.journey.title.padEnd(w)}  ${String(b).padEnd(8)}  ${String(h).padEnd(8)}  ${lightText(r.decision.light)}  ${color.dim(r.decision.reasons[0] || '')}`);
  }
  log.raw('');
}

async function doctor(log) {
  let ok = true;
  const node = process.versions.node;
  (Number(node.split('.')[0]) >= 20 ? log.ok : log.fail)(`node ${node}`);
  const gitv = await run('git', ['--version'], { timeoutMs: 10000 });
  (gitv.code === 0 ? log.ok : log.fail)(gitv.stdout.trim() || 'git not found');
  const kv = await run('kane-cli', ['--version'], { timeoutMs: 30000 });
  if (kv.code === 0) log.ok(`kane-cli ${kv.stdout.trim().split(/\s+/).pop()}`);
  else { ok = false; log.fail('kane-cli not found: npm i -g @testmuai/kane-cli'); }
  if (kv.code === 0) {
    const info = await kaneInfo();
    const loggedIn = info.whoamiCode === 0 && !/not logged in|not authenticated|method\s+none/i.test(info.whoami + info.balance);
    if (loggedIn || (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY)) log.ok('kane-cli authenticated');
    else { ok = false; log.fail('kane-cli is not logged in: kane-cli login --oauth (or set LT_USERNAME / LT_ACCESS_KEY)'); }
    const bal = (info.balance.match(/(?:balance|credits?|available)\D{0,40}?(\d[\d,]*(?:\.\d+)?)/i) || [])[1];
    if (bal) log.info(`credits: ${bal}`);
  }
  for (const [bin, name] of [['codex', 'Codex'], ['claude', 'Claude Code']]) {
    const r = await run(bin, ['--version'], { timeoutMs: 20000 });
    (r.code === 0 ? log.ok : log.warn)(`${name}: ${r.code === 0 ? r.stdout.trim().split('\n')[0] : 'not installed (only needed for --fix)'}`);
  }
  return ok ? 0 : 1;
}

export { HELP };
