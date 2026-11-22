// Backtest control set (read-only GitHub): bot bumps of the same risky frontend packages that were MERGED
// and never reverted: the default branch still carries the new major a month or more later.
// A red verdict on one of these counts as a false alarm.
//   node search-controls.mjs   -> radar/controls.json
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ghq = (args) => { try { return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'] })); } catch { return null; } };
const TITLE = /bump\s+(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+?)(?:\s+in\s+(\S+))?$/i;
const major = (v) => String(v).replace(/^[^\d]*/, '').split('.')[0];

// Same families as the reverted corpus and the demo, so the comparison is like for like.
const TARGETS = { zod: '3', '@tanstack/react-query': '4', 'react-router-dom': '6', 'react-router': '6', '@mui/material': '7', tailwindcss: '3',
  recharts: '2', 'react-markdown': '9', 'react-i18next': '15', 'framer-motion': '11', 'date-fns': '3', 'react-toastify': '10', clsx: '1',
  'lucide-react': '0', zustand: '4', uuid: '10', 'react-icons': '4', swiper: '10', 'react-hook-form': '6', i18next: '24' };

const found = [];
for (const [pkg, from] of Object.entries(TARGETS)) {
  const q = `is:pr is:merged in:title "bump ${pkg} from ${from}" merged:2026-06-01..2026-10-20`;
  const res = ghq(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=40']);
  await sleep(2500);
  for (const it of res?.items || []) {
    const m = it.title.replace(/^[\w()\-/ ]*?:\s*/, '').match(TITLE);
    if (!m || m[1].toLowerCase() !== pkg || !/dependabot|renovate/i.test(it.user?.login || '')) continue;
    if (major(m[2]) === major(m[3])) continue;
    found.push({ repo: it.repository_url.replace('https://api.github.com/repos/', ''), pr: it.number, title: it.title, pkg, from: m[2], to: m[3], dir: m[4] || '/' });
  }
  process.stdout.write(`${pkg}: ${found.length}\n`);
}

const out = [];
for (const r of found) {
  const info = ghq(['api', `repos/${r.repo}`]);
  if (!info || info.archived || info.fork || info.private || info.size > 60000) continue;
  const dir = r.dir === '/' ? '' : r.dir.replace(/^\//, '') + '/';
  const pkgFile = ghq(['api', `repos/${r.repo}/contents/${dir}package.json?ref=${info.default_branch}`]);
  if (!pkgFile?.content) continue;
  let pkg; try { pkg = JSON.parse(Buffer.from(pkgFile.content, 'base64').toString('utf8')); } catch { continue; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const now = deps[r.pkg];
  if (!now || Number(major(now)) < Number(major(r.to))) continue; // downgraded or removed: not a clean control
  const fw = ['vite', 'react-scripts', '@vitejs/plugin-react', 'next'].filter((d) => deps[d]);
  const backend = Object.keys(deps).filter((d) => /^(express|fastify|prisma|@prisma\/client|firebase|@supabase\/supabase-js|mongoose|pg|mysql2|next-auth|@clerk\/.+|@auth0\/.+|@nestjs\/core|socket\.io-client|aws-amplify|convex)$/.test(d));
  if (!fw.some((f) => f !== 'next') || deps.next || backend.length) continue;
  const pr = ghq(['pr', 'view', String(r.pr), '-R', r.repo, '--json', 'mergedAt,mergeCommit,statusCheckRollup']);
  if (!pr?.mergeCommit?.oid) continue;
  // no revert of this PR in the repo
  const rev = ghq(['api', '-X', 'GET', 'search/commits', '-f', `q=repo:${r.repo} "Revert" "${r.pkg}"`]);
  await sleep(2500);
  if ((rev?.items || []).some((c) => /revert/i.test(c.commit.message) && c.commit.message.includes(r.pkg))) continue;
  const checks = {};
  for (const c of pr.statusCheckRollup || []) { const k = c.conclusion || c.state || 'PENDING'; checks[k] = (checks[k] || 0) + 1; }
  out.push({ ...r, kind: 'control', merged: pr.mergedAt.slice(0, 10), bump: pr.mergeCommit.oid, nowVersion: now, checks, stars: info.stargazers_count, sizeKB: info.size, desc: (info.description || '').slice(0, 100), fw });
  console.log(`${r.repo.padEnd(42)} #${r.pr} ${r.pkg} ${r.from}→${r.to} merged ${pr.mergedAt.slice(0, 10)} now ${now} checks=${JSON.stringify(checks)}`);
}
writeFileSync(new URL('./controls.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`\n${out.length} clean controls (merged, never reverted, still on the new major, plain web app)`);
