// What did the bot bump? Read it from the PR title and confirm it from package files.

const BOT_LOGINS = new Set(['dependabot[bot]', 'renovate[bot]', 'dependabot-preview[bot]', 'app/dependabot', 'app/renovate']);

export function isBotAuthor(login = '') {
  return BOT_LOGINS.has(String(login).toLowerCase());
}

/**
 * Parse Dependabot / Renovate PR titles.
 * Returns [{name, from?, to?}] (Renovate titles often carry only the target).
 */
export function parseTitle(title = '') {
  const t = String(title).trim();
  const out = [];
  // Dependabot: "Bump vite from 5.4.1 to 6.0.0" / "chore(deps): bump vite from 5.4.1 to 6.0.0 in /web"
  let m = t.match(/\bbump\s+(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+?)(?:\s+in\s+\S+)?$/i);
  if (m) {
    out.push({ name: m[1], from: m[2], to: m[3] });
    return out;
  }
  // Dependabot grouped: "Bump the npm_and_yarn group across 1 directory with 3 updates"
  if (/\bbump the\s+\S+\s+group\b/i.test(t)) return out;
  // Renovate: "Update dependency vite to v6" / "fix(deps): update dependency @mui/material to v9.0.0"
  m = t.match(/\bupdate\s+dependency\s+(\S+)\s+to\s+v?([\w.\-+]+)/i);
  if (m) {
    out.push({ name: m[1], to: m[2] });
    return out;
  }
  // Renovate monorepo: "Update react monorepo to v19 (major)"
  m = t.match(/\bupdate\s+(\S+)\s+monorepo\s+to\s+v?([\w.\-+]+)/i);
  if (m) {
    out.push({ name: `${m[1]} monorepo`, to: m[2], monorepo: true });
    return out;
  }
  // Renovate: "Update all non-major dependencies"
  return out;
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Ranges in package.json that changed between base and head. */
export function diffPackageJson(basePkg = {}, headPkg = {}) {
  const changes = [];
  for (const field of DEP_FIELDS) {
    const a = basePkg[field] || {};
    const b = headPkg[field] || {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[name] !== b[name]) {
        changes.push({ name, field, fromRange: a[name] ?? null, toRange: b[name] ?? null });
      }
    }
  }
  return changes;
}

/** Top-level installed versions from package-lock.json (v1, v2 or v3). */
export function lockVersions(lock = {}) {
  const out = {};
  if (lock.packages) {
    for (const [key, meta] of Object.entries(lock.packages)) {
      const m = key.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
      if (m && meta && meta.version) out[m[1]] = meta.version;
    }
  } else if (lock.dependencies) {
    for (const [name, meta] of Object.entries(lock.dependencies)) {
      if (meta && meta.version) out[name] = meta.version;
    }
  }
  return out;
}

/** Top-level versions from a pnpm-lock.yaml (text), importer "." only. Best effort, no YAML lib. */
export function pnpmLockVersions(text = '') {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  let inImporterRoot = false;
  let inDeps = false;
  let current = null;
  for (const line of lines) {
    if (/^importers:\s*$/.test(line)) { inImporterRoot = false; continue; }
    if (/^ {2}\.:\s*$/.test(line)) { inImporterRoot = true; continue; }
    if (/^ {2}\S/.test(line) && !/^ {2}\.:/.test(line)) { inImporterRoot = false; }
    if (!inImporterRoot) continue;
    if (/^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/.test(line)) { inDeps = true; continue; }
    if (/^ {4}\S/.test(line)) { inDeps = false; continue; }
    if (!inDeps) continue;
    let m = line.match(/^ {6}'?([^':]+)'?:\s*$/);
    if (m) { current = m[1]; continue; }
    m = line.match(/^ {8}version:\s*'?([^'(\s]+)/);
    if (m && current) { out[current] = m[1]; current = null; }
  }
  return out;
}

/** Installed versions that differ between two lockfile version maps, limited to direct deps when given. */
export function diffLock(baseMap = {}, headMap = {}, only = null) {
  const names = only ? [...only] : [...new Set([...Object.keys(baseMap), ...Object.keys(headMap)])];
  const out = [];
  for (const name of names) {
    if (baseMap[name] !== headMap[name] && (baseMap[name] || headMap[name])) {
      out.push({ name, from: baseMap[name] ?? null, to: headMap[name] ?? null });
    }
  }
  return out;
}

/**
 * Combine title + package.json + lockfile into one list of bumps.
 * Lockfile versions win (they are what actually got installed).
 */
export function summariseBump({ title, basePkg, headPkg, baseLock, headLock }) {
  const fromTitle = parseTitle(title);
  const ranges = diffPackageJson(basePkg, headPkg);
  const direct = new Set([...ranges.map((r) => r.name), ...fromTitle.filter((t) => !t.monorepo).map((t) => t.name)]);
  const locked = baseLock && headLock ? diffLock(baseLock, headLock, direct.size ? direct : null) : [];

  const byName = new Map();
  for (const t of fromTitle) byName.set(t.name, { name: t.name, from: t.from ?? null, to: t.to ?? null, source: 'title' });
  for (const r of ranges) {
    const prev = byName.get(r.name) || { name: r.name, source: 'package.json' };
    byName.set(r.name, {
      ...prev,
      field: r.field,
      fromRange: r.fromRange,
      toRange: r.toRange,
      from: prev.from ?? cleanRange(r.fromRange),
      to: prev.to ?? cleanRange(r.toRange),
    });
  }
  for (const l of locked) {
    const prev = byName.get(l.name) || { name: l.name, source: 'lockfile' };
    byName.set(l.name, { ...prev, from: l.from ?? prev.from ?? null, to: l.to ?? prev.to ?? null, locked: true });
  }
  // Drop monorepo placeholders when we found the real packages.
  const list = [...byName.values()].filter((b) => !(b.name.endsWith(' monorepo') && byName.size > 1));
  return list.map((b) => ({ ...b, major: isMajor(b.from, b.to) }));
}

export function cleanRange(r) {
  if (!r) return null;
  const m = String(r).match(/(\d+(?:\.\d+){0,2}(?:-[\w.]+)?)/);
  return m ? m[1] : null;
}

export function isMajor(from, to) {
  const a = semverParts(from);
  const b = semverParts(to);
  if (!a || !b) return false;
  if (a[0] === 0 && b[0] === 0) return a[1] !== b[1];
  return a[0] !== b[0];
}

export function semverParts(v) {
  const m = String(v || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/** Compare two semver-ish strings: -1, 0, 1. Pre-release tags sort before the release. */
export function compareVersions(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  const preA = /-/.test(String(a).replace(/^[^\d]*/, ''));
  const preB = /-/.test(String(b).replace(/^[^\d]*/, ''));
  if (preA !== preB) return preA ? -1 : 1;
  return 0;
}

export function bumpLabel(bumps) {
  if (!bumps.length) return 'dependency update';
  if (bumps.length === 1) {
    const b = bumps[0];
    return b.from ? `${b.name} ${b.from} → ${b.to}` : `${b.name} → ${b.to}`;
  }
  return `${bumps.length} packages (${bumps.slice(0, 3).map((b) => b.name).join(', ')}${bumps.length > 3 ? ', …' : ''})`;
}
