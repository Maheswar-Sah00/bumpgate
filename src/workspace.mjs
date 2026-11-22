// Check out base and bump side by side (git worktrees), install, build and serve each.
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { git, gitOk, sh } from './sh.mjs';
import { resolveCommands } from './config.mjs';
import { serveStatic, serveCommand } from './serve.mjs';

export function workRoot(repoDir) {
  const base = process.env.BUMPGATE_WORK || path.join(os.tmpdir(), 'bumpgate');
  const id = createHash('sha1').update(path.resolve(repoDir)).digest('hex').slice(0, 8);
  return path.join(base, `${path.basename(path.resolve(repoDir))}-${id}`);
}

export function resolveRef(repoDir, ref) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`], repoDir);
}

/** Create (or reuse) a detached worktree of `sha` at `dir`. */
export function checkout(repoDir, sha, dir) {
  if (existsSync(dir)) {
    const head = gitOk(['rev-parse', 'HEAD'], dir);
    if (head.ok && head.out === sha) return dir;
    gitOk(['worktree', 'remove', '--force', dir], repoDir);
    rmSync(dir, { recursive: true, force: true });
  }
  gitOk(['worktree', 'prune'], repoDir);
  mkdirSync(path.dirname(dir), { recursive: true });
  git(['worktree', 'add', '--detach', '--force', dir, sha], repoDir);
  return dir;
}

export function removeCheckout(repoDir, dir) {
  gitOk(['worktree', 'remove', '--force', dir], repoDir);
  rmSync(dir, { recursive: true, force: true });
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** Install + build one side. Returns {ok, step, log, commands, seconds}. */
export async function buildSide(dir, cfg, { onLog, skipInstall = false } = {}) {
  const commands = resolveCommands(cfg, dir);
  const started = Date.now();
  const env = { CI: 'true', NODE_ENV: undefined, BROWSER: 'none', NEXT_TELEMETRY_DISABLED: '1', HUSKY: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  delete env.NODE_ENV;
  if (!skipInstall || !existsSync(path.join(dir, 'node_modules'))) {
    onLog?.(`install: ${commands.install}`);
    let r = await sh(commands.install, { cwd: dir, env, timeoutMs: 15 * 60 * 1000 });
    // Many repos install with legacy peer deps (an .npmrc or a habit); npm ci refuses with ERESOLVE.
    if (r.code !== 0 && /^npm (ci|install)\b/.test(commands.install) && /ERESOLVE/.test(r.stdout + r.stderr)) {
      commands.install = `${commands.install} --legacy-peer-deps`;
      onLog?.(`install: peer-dependency conflict, retrying: ${commands.install}`);
      r = await sh(commands.install, { cwd: dir, env, timeoutMs: 15 * 60 * 1000 });
    }
    if (r.code !== 0) return { ok: false, step: 'install', log: tail(r.stdout + r.stderr), commands, seconds: secs(started) };
  }
  if (commands.build) {
    onLog?.(`build: ${commands.build}`);
    const r = await sh(commands.build, { cwd: dir, env, timeoutMs: 15 * 60 * 1000 });
    if (r.code !== 0) return { ok: false, step: 'build', log: tail(r.stdout + r.stderr), commands, seconds: secs(started) };
  }
  return { ok: true, step: 'done', log: '', commands, seconds: secs(started) };
}

/** Serve a built side on `port`. Returns {url, stop}. */
export async function serveSide(dir, commands, port) {
  const s = commands.serve;
  if (s.type === 'cmd') {
    return serveCommand(s.cmd, { cwd: dir, port, path: s.path || '/' });
  }
  const root = path.join(dir, s.dir || 'dist');
  if (!existsSync(root)) throw new Error(`build output not found: ${path.relative(dir, root) || root}`);
  return serveStatic(root, { port, spa: s.spa !== false, base: s.base || '/' });
}

function tail(s, n = 4000) {
  s = String(s || '');
  return s.length > n ? '…' + s.slice(-n) : s;
}

function secs(t) {
  return Math.round((Date.now() - t) / 1000);
}
