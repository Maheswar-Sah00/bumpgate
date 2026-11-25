// Process helpers. No dependencies; Windows-safe (no .cmd spawning without a shell).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

// The repo's own install, build and serve commands run code from the bump (npm install scripts),
// and the fix agent runs commands too. Neither gets Bumpgate's secrets: the TestMu key, the GitHub
// token, other agents' keys or the Actions runtime tokens.
const SECRET = /(TOKEN|SECRET|PASSWORD|PASSWD|ACCESS_KEY|API_KEY|PRIVATE_KEY|CREDENTIAL)|^LT_|^ACTIONS_ID_TOKEN|^ACTIONS_RUNTIME|^ACTIONS_CACHE/i;

/** process.env minus anything that looks like a secret, except the names in `keep`. */
export function scrubEnv(env = process.env, keep = []) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (keep.includes(k) || !SECRET.test(k)) out[k] = v;
  return out;
}

/**
 * Run a shell command string (used for the repo's own install/build/serve commands).
 * Resolves with { code, stdout, stderr, timedOut }. Never rejects on a non-zero exit.
 */
export function sh(command, { cwd, env, timeoutMs = 0, onLine, quiet = true } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: { ...scrubEnv(), ...env },
      shell: true,
      windowsHide: true,
      detached: !IS_WIN,
    });
    collect(child, { timeoutMs, onLine, quiet }, resolve);
  });
}

/**
 * Run a binary with an argument array (no shell). On Windows, npm shims (.cmd) are
 * resolved to their node entry point so arguments are never re-parsed by cmd.exe.
 */
export function run(bin, args, { cwd, env, timeoutMs = 0, onLine, input, quiet = true, keepSecrets = null } = {}) {
  return new Promise((resolve) => {
    // keepSecrets: null = full environment (kane-cli, git); an array = scrubbed, keeping only those names.
    const base = Array.isArray(keepSecrets) ? scrubEnv(process.env, keepSecrets) : process.env;
    const [file, pre] = resolveBin(bin);
    const viaCmd = IS_WIN && /\.(cmd|bat)$/i.test(file);
    const all = [...pre, ...args];
    const child = viaCmd
      // Last resort for shims we could not unwrap: quote every argument for cmd.exe.
      ? spawn(`"${file}" ${all.map(cmdQuote).join(' ')}`, { cwd, env: { ...base, ...env }, shell: true, windowsHide: true })
      : spawn(file, all, { cwd, env: { ...base, ...env }, shell: false, windowsHide: true, detached: !IS_WIN });
    if (input != null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
    collect(child, { timeoutMs, onLine, quiet }, resolve);
  });
}

/** Synchronous git helper that throws on failure. */
export function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
  return r.stdout.trim();
}

export function gitOk(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function collect(child, { timeoutMs, onLine, quiet }, resolve) {
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let buf = '';
  let timer = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
  }
  child.stdout.on('data', (d) => {
    const s = d.toString();
    stdout += s;
    if (!quiet) process.stderr.write(s);
    if (onLine) {
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        try { onLine(line, 'stdout'); } catch { /* a bad listener must not kill the run */ }
      }
    }
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    stderr += s;
    if (!quiet) process.stderr.write(s);
  });
  child.on('error', (err) => {
    if (timer) clearTimeout(timer);
    resolve({ code: 127, stdout, stderr: stderr + String(err && err.message), timedOut });
  });
  child.on('close', (code) => {
    if (timer) clearTimeout(timer);
    if (onLine && buf.length) {
      try { onLine(buf.replace(/\r$/, ''), 'stdout'); } catch { /* ignore */ }
    }
    resolve({ code: code ?? 1, stdout, stderr, timedOut });
  });
}

/** Kill a process and all of its children. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      }, 3000).unref();
    }
  } catch { /* already gone */ }
}

const binCache = new Map();

/**
 * Turn a command name into [file, prefixArgs]. Honour BUMPGATE_<NAME>_BIN overrides.
 * On Windows, a global npm shim `foo.cmd` is mapped to `node <pkg entry>` when we can find it.
 */
export function resolveBin(bin) {
  if (binCache.has(bin)) return binCache.get(bin);
  const envKey = `BUMPGATE_${bin.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_BIN`;
  let result = [bin, []];
  if (process.env[envKey]) {
    const p = process.env[envKey];
    result = /\.(c|m)?js$/.test(p) ? [process.execPath, [p]] : [p, []];
  } else if (IS_WIN) {
    const where = spawnSync('where', [bin], { encoding: 'utf8', windowsHide: true });
    const hits = (where.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const exe = hits.find((h) => /\.exe$/i.test(h));
    const cmd = hits.find((h) => /\.cmd$/i.test(h));
    if (exe) {
      result = [exe, []];
    } else if (cmd) {
      const entry = entryFromShim(cmd);
      result = entry ? [process.execPath, [entry]] : [cmd, []];
    }
  }
  binCache.set(bin, result);
  return result;
}

// npm writes shims like: "%_prog%"  "%dp0%\node_modules\@testmuai\kane-cli\bin\kane-cli.cjs" %*
function entryFromShim(cmdPath) {
  try {
    const text = readFileSync(cmdPath, 'utf8');
    const m = text.match(/%dp0%\\([^"\s]+\.(?:c|m)?js)/i);
    if (!m) return null;
    const entry = path.join(path.dirname(cmdPath), m[1]);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

function cmdQuote(a) {
  return `"${String(a).replace(/"/g, '""').replace(/%/g, '"%"')}"`;
}

export const isWindows = IS_WIN;
