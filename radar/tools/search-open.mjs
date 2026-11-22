// F1 Live Bump Radar, step 1 (read-only GitHub): find OPEN Dependabot/Renovate PRs that bump one risky
// frontend runtime package across a major (or a known-dangerous minor), in small plain web apps.
//   node search-open.mjs            -> radar/open-prs.json
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ghq = (args) => { try { return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'] })); } catch { return null; } };

// package -> which "from" majors to look for (the breaking jumps of the last year)
const TARGETS = {
  zod: ['3'], '@tanstack/react-query': ['4'], 'react-router-dom': ['6'], 'react-router': ['6'], '@mui/material': ['5', '6', '7'],
  tailwindcss: ['3'], recharts: ['2'], 'framer-motion': ['10', '11'], antd: ['4', '5'], '@chakra-ui/react': ['2'],
  'react-i18next': ['13', '14', '15'], i18next: ['23', '24'], 'react-markdown': ['8', '9'], swiper: ['8', '9', '10'],
  'react-hook-form': ['6'], 'date-fns': ['2', '3'], '@headlessui/react': ['1'], 'react-toastify': ['9', '10'],
  'react-leaflet': ['4'], 'styled-components': ['5'], 'chart.js': ['3'], 'react-chartjs-2': ['4'], 'vue-router': ['3'],
  pinia: ['2'], react: ['18', '19.2'], 'react-dom': ['18'], 'lucide-react': ['0'], 'react-select': ['4'], 'react-datepicker': ['7'],
  zustand: ['4'], '@reduxjs/toolkit': ['1'], 'react-redux': ['8'], uuid: ['9', '10'], 'react-icons': ['4'],
};
const TITLE = /bump\s+(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+?)(?:\s+in\s+(\S+))?$/i;
const major = (v) => String(v).split('.')[0];

const seen = new Map();
for (const [pkg, froms] of Object.entries(TARGETS)) {
  for (const from of froms) {
    const q = `is:pr is:open in:title "bump ${pkg} from ${from}" created:>=2026-08-01`;
    const res = ghq(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=50', '-f', 'sort=created']);
    await sleep(2500); // search API: 30 requests/minute
    for (const it of res?.items || []) {
      const t = it.title.replace(/^[\w()\-/ ]*?:\s*/, '');
      const m = t.match(TITLE);
      if (!m || m[1].toLowerCase() !== pkg) continue;
      const user = it.user?.login || '';
      if (!/dependabot|renovate/i.test(user)) continue;
      const [, , vFrom, vTo, dir] = m;
      const dangerous = major(vFrom) !== major(vTo) || (pkg === 'react' && /^19\.2/.test(vFrom) && /^19\.3/.test(vTo));
      if (!dangerous) continue;
      const repo = it.repository_url.replace('https://api.github.com/repos/', '');
      seen.set(`${repo}#${it.number}`, { repo, pr: it.number, title: it.title, pkg, from: vFrom, to: vTo, dir: dir || '/', created: it.created_at.slice(0, 10), url: it.html_url, bot: user });
    }
  }
  process.stdout.write(`${pkg}: ${seen.size} so far\n`);
}

// Vet each repo: small, not archived/fork, a plain web app (vite/CRA/etc), no obvious backend or auth.
const out = [];
for (const r of seen.values()) {
  const info = ghq(['api', `repos/${r.repo}`]);
  if (!info || info.archived || info.fork || info.private) continue;
  if (info.size > 60000) continue; // KB; skip big monorepos
  const dir = r.dir === '/' ? '' : r.dir.replace(/^\//, '') + '/';
  const pkgFile = ghq(['api', `repos/${r.repo}/contents/${dir}package.json?ref=${info.default_branch}`]);
  if (!pkgFile?.content) continue;
  let pkg; try { pkg = JSON.parse(Buffer.from(pkgFile.content, 'base64').toString('utf8')); } catch { continue; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const fw = ['vite', 'react-scripts', '@vitejs/plugin-react', 'next', 'astro', '@sveltejs/kit', 'vue', 'react'].filter((d) => deps[d]);
  const backend = Object.keys(deps).filter((d) => /^(express|fastify|prisma|@prisma\/client|firebase|@supabase\/supabase-js|mongoose|pg|mysql2|next-auth|@clerk\/.+|@auth0\/.+|@nestjs\/core|socket\.io-client|aws-amplify|convex)$/.test(d));
  const reactDomPinned = r.pkg === 'react' ? deps['react-dom'] : undefined;
  const row = { ...r, stars: info.stargazers_count, sizeKB: info.size, pushed: info.pushed_at?.slice(0, 10), homepage: info.homepage || null,
    desc: (info.description || '').slice(0, 100), fw, backend, scripts: Object.keys(pkg.scripts || {}).join(','), reactDomPinned,
    plain: fw.some((f) => ['vite', 'react-scripts', '@vitejs/plugin-react'].includes(f)) && !backend.length && !deps.next };
  out.push(row);
  await sleep(300);
}
out.sort((a, b) => (b.plain - a.plain) || b.created.localeCompare(a.created));
writeFileSync(new URL('./open-prs.json', import.meta.url), JSON.stringify(out, null, 1));
for (const r of out) console.log(`${r.plain ? 'PLAIN' : '     '} ${r.created} ${r.repo.padEnd(42)} #${r.pr} ${r.pkg} ${r.from}→${r.to} dir=${r.dir} fw=${r.fw.join('+')} be=${r.backend.join('+') || '-'}${r.reactDomPinned ? ' react-dom=' + r.reactDomPinned : ''}`);
console.log(`\n${out.length} open PRs vetted, ${out.filter((r) => r.plain).length} plain web apps`);
