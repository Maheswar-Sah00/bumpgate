// bumpgate.config.json (optional). Everything has a default detected from package.json.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  journeys: '.kane',          // folder of *_test.md journeys, always read from BASE
  appDir: '',                 // subfolder holding the app's package.json (monorepos, /front, /web)
  install: null,              // detected from the lockfile
  build: null,                // "npm run build" when a build script exists
  serve: null,                // {type:"static", dir, spa, base} | {type:"cmd", cmd, path}
  port: 4319,                 // base and bump are served on the same port, one after the other
  confirmRuns: 3,             // re-run a disagreeing journey up to this many times; majority decides
  amber: 'review',            // what a yellow light does: review | merge | block
  agent: 'claude',            // claude | codex | none
  maxFixAttempts: 3,
  kane: { timeout: 300, maxSteps: 30, maxRuns: 30, local: true, headed: false, policies: [] },
  protect: [],                // extra paths the fix agent may never touch
  publishPacks: false,        // raw packs carry the Kane account email: opt in to publish them
};

export function loadConfig(repoDir, overrides = {}) {
  const file = ['bumpgate.config.json', '.bumpgate.json'].map((f) => path.join(repoDir, f)).find(existsSync);
  let user = {};
  if (file) {
    try {
      user = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`${path.basename(file)} is not valid JSON: ${e.message}`);
    }
  }
  const cfg = { ...DEFAULTS, ...user, ...strip(overrides) };
  cfg.kane = { ...DEFAULTS.kane, ...(user.kane || {}), ...(overrides.kane || {}) };
  cfg.file = file || null;
  return cfg;
}

function strip(o) {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && k !== 'kane'));
}

/** Fill install/build/serve from the checked-out side's package.json and lockfile. */
export function resolveCommands(cfg, sideDir) {
  const pkgPath = path.join(sideDir, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  const scripts = pkg.scripts || {};
  const pm = detectPackageManager(sideDir);
  const install = cfg.install || {
    npm: 'npm ci --no-audit --no-fund',
    pnpm: 'pnpm install --frozen-lockfile',
    yarn: 'yarn install --frozen-lockfile',
    bun: 'bun install --frozen-lockfile',
  }[pm];
  const runner = pm === 'npm' ? 'npm run' : pm;
  const build = cfg.build ?? (scripts.build ? `${runner} build` : null);
  let serve = cfg.serve;
  if (!serve) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next) serve = { type: 'cmd', cmd: `npx next start -p $PORT`, path: '/' };
    else if (deps['react-scripts']) serve = { type: 'static', dir: 'build', spa: true };
    else if (deps['@angular/core']) serve = { type: 'static', dir: guessAngularDist(sideDir, pkg), spa: true };
    else if (deps.astro) serve = { type: 'static', dir: 'dist', spa: false };
    else if (deps['@sveltejs/kit']) serve = { type: 'cmd', cmd: `${runner} preview -- --port $PORT --strictPort`, path: '/' };
    else serve = { type: 'static', dir: 'dist', spa: true };
  }
  return { pm, install, build, serve };
}

export function detectPackageManager(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

function guessAngularDist(dir, pkg) {
  try {
    const ng = JSON.parse(readFileSync(path.join(dir, 'angular.json'), 'utf8'));
    const project = Object.values(ng.projects || {})[0];
    const out = project?.architect?.build?.options?.outputPath;
    if (typeof out === 'string') return existsSync(path.join(dir, out, 'browser')) ? path.join(out, 'browser') : out;
    if (out && out.base) return path.join(out.base, 'browser');
  } catch { /* fall through */ }
  return `dist/${pkg.name || 'app'}/browser`;
}
