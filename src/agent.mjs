// Hand Kane's evidence to a coding agent (Codex or Claude Code) and capture the transcript.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './sh.mjs';

export const AGENTS = {
  codex: { name: 'Codex', bin: 'codex' },
  claude: { name: 'Claude Code', bin: 'claude' },
};

/** The task file the agent reads. Everything here comes from Kane's run, the release notes and the diff. */
export function buildTask({ bump, failures, notes, journeysDir, buildCmd, previous = [], protect = [] }) {
  const L = [];
  L.push('# Task: make the app work again on a dependency upgrade');
  L.push('');
  L.push(`A bot opened a dependency-upgrade PR: **${bump.name} ${bump.from || '?'} → ${bump.to || '?'}**${bump.major ? ' (major)' : ''}.`);
  L.push('The build and CI pass, but Kane CLI replayed the app\'s critical user journeys in a real browser and found that');
  L.push('they work on the base branch and break on the upgrade. Your job is to migrate the app\'s source code to the new version.');
  L.push('');
  for (const f of failures) {
    L.push(`## Broken journey: "${f.title}"`);
    L.push('');
    L.push('The journey, exactly as Kane runs it:');
    L.push('');
    L.push('```markdown');
    L.push(f.text.trim());
    L.push('```');
    L.push('');
    if (f.failedStep) L.push(`It passes on base and breaks on the upgrade at step ${f.failedStep.index}: **${f.failedStep.heading}**.`);
    if (f.reason) L.push(`Kane's reason: ${f.reason}`);
    if (f.bug?.title) L.push(`Kane's bug verdict: ${f.bug.title}${f.bug.severity ? ` (severity ${f.bug.severity})` : ''}`);
    if (f.diagnosis) L.push('', 'Kane\'s diagnosis of the failure:', '```', f.diagnosis.slice(0, 1500), '```');
    if (f.consoleErrors?.length) {
      L.push('', 'Console errors that appear only on the upgrade:', '```', ...f.consoleErrors.slice(0, 10), '```');
    }
    if (f.networkErrors?.length) {
      L.push('', 'Failed requests that appear only on the upgrade:', '```', ...f.networkErrors.slice(0, 10), '```');
    }
    if (f.failureText) L.push('', 'Kane\'s failure record:', '```yaml', f.failureText.slice(0, 2500), '```');
    if (f.shots?.bump) L.push('', `Screenshot of the failure on the upgrade: ${f.shots.bump}`);
    if (f.shots?.base) L.push(`Screenshot of the same step on base: ${f.shots.base}`);
    L.push('');
  }
  if (notes?.length) {
    L.push('## Release notes between the two versions');
    L.push('');
    for (const n of notes) {
      if (n.empty) {
        L.push(`(${n.name}: no changelog found locally${n.repo ? `; repository https://github.com/${n.repo}` : ''}.)`);
        continue;
      }
      L.push(`### ${n.name} ${n.from} → ${n.to}${n.repo ? ` (https://github.com/${n.repo})` : ''}`);
      L.push('');
      L.push(n.text);
      L.push('');
    }
  }
  if (previous.length) {
    L.push('## Earlier attempts that did not work');
    L.push('');
    for (const p of previous) {
      L.push(`- Attempt ${p.n}: ${p.rejected
        ? `rejected by the code checks (${p.rejected}); its changes were discarded.`
        : `its changes are still in the working tree, but Kane still fails: ${p.failedJourney || ''}${p.reason ? ` (${p.reason})` : ''}. The evidence above is from that run.`}`);
      if (p.diffStat) L.push(`  Files it changed: ${p.diffStat}`);
    }
    L.push('');
  }
  L.push('## Rules (checked by code after you finish; breaking one discards your work)');
  L.push('');
  L.push(`1. Keep ${bump.name} at ${bump.to}. Do not downgrade, pin back or remove it.`);
  L.push(`2. Do not edit anything under \`${journeysDir}/\`, bumpgate.config.json${protect.length ? ', ' + protect.map((p) => `\`${p}\``).join(', ') : ''}.`);
  L.push('3. Do not delete or hide features to make the journey pass. Fix the code that uses the library.');
  L.push('4. Keep the change minimal and idiomatic for the new version; follow the release notes and the library\'s migration guide.');
  if (buildCmd) L.push(`5. Run \`${buildCmd}\` and make sure it succeeds.`);
  L.push('');
  L.push('Do not commit. When you are done, reply with two or three sentences: what was broken and what you changed.');
  return L.join('\n');
}

/** Run the agent in `cwd` on the task file. Returns {ok, summary, transcriptPath, code}. */
export async function runAgent(kind, { cwd, taskFile, outDir, attempt, images = [], timeoutMs = 20 * 60 * 1000, onLine }) {
  mkdirSync(outDir, { recursive: true });
  const transcriptPath = path.join(outDir, `attempt-${attempt}.${kind}.jsonl`);
  const lastPath = path.join(outDir, `attempt-${attempt}.summary.txt`);
  const prompt = `Read the task in ${taskFile} and do it in this repository (${cwd}). Follow its rules exactly.`;
  let res;
  if (kind === 'codex') {
    const args = ['exec', '--full-auto', '--skip-git-repo-check', '--json', '-C', cwd, '--output-last-message', lastPath];
    for (const img of images) if (img && existsSync(img)) args.push('-i', img);
    if (process.env.BUMPGATE_CODEX_MODEL) args.push('-m', process.env.BUMPGATE_CODEX_MODEL);
    args.push(prompt);
    res = await run('codex', args, { cwd, timeoutMs, onLine });
  } else if (kind === 'claude') {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash(npm run *),Bash(npm ci*),Bash(npx tsc*),Bash(git diff*),Bash(git status*),Bash(cat *),Bash(ls *)',
      '--add-dir', path.dirname(taskFile)];
    if (process.env.BUMPGATE_CLAUDE_MODEL) args.push('--model', process.env.BUMPGATE_CLAUDE_MODEL);
    res = await run('claude', args, { cwd, timeoutMs, onLine });
  } else {
    throw new Error(`unknown agent "${kind}" (use codex, claude or none)`);
  }
  writeFileSync(transcriptPath, res.stdout || '');
  if (res.stderr) writeFileSync(transcriptPath.replace(/\.jsonl$/, '.stderr.txt'), res.stderr);
  let summary = existsSync(lastPath) ? readFileSync(lastPath, 'utf8').trim() : '';
  if (!summary) summary = lastAssistantText(kind, res.stdout);
  if (summary) writeFileSync(lastPath, summary);
  return { ok: res.code === 0 && !res.timedOut, code: res.code, timedOut: res.timedOut, summary, transcriptPath, stderr: res.stderr };
}

/** Pull the agent's final message out of its JSONL stream. */
export function lastAssistantText(kind, stdout = '') {
  let last = '';
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const ev = JSON.parse(line);
      if (kind === 'claude') {
        if (ev.type === 'result' && typeof ev.result === 'string') last = ev.result;
        else if (ev.type === 'assistant') {
          const t = (ev.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          if (t) last = t;
        }
      } else {
        const item = ev.item || ev.msg || ev;
        if ((item.type === 'agent_message' || item.item_type === 'assistant_message') && (item.text || item.message)) {
          last = item.text || item.message;
        }
      }
    } catch { /* not JSON */ }
  }
  return String(last).trim();
}
