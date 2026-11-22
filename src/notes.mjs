// Release notes between two versions: the package's own CHANGELOG (already installed on the
// bump side, no network), then GitHub Releases for its repository.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { compareVersions, semverParts } from './deps.mjs';

export function inRange(v, from, to) {
  if (!semverParts(v)) return false;
  if (from && compareVersions(v, from) <= 0) return false;
  if (to && compareVersions(v, to) > 0) return false;
  return true;
}

const HEADING = /^(#{1,4})\s*\[?v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\]?(?:\s|\(|$|\s*-)/;

/** Slice a CHANGELOG.md into the sections for versions in (from, to]. */
export function sliceChangelog(text, from, to) {
  const lines = String(text).split(/\r?\n/);
  const sections = [];
  let cur = null;
  let level = null;
  for (const line of lines) {
    const m = line.match(HEADING);
    if (m && (level === null || m[1].length <= level)) {
      if (cur) sections.push(cur);
      level = m[1].length;
      cur = { version: m[2], lines: [line] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) sections.push(cur);
  return sections
    .filter((s) => inRange(s.version, from, to))
    .map((s) => ({ version: s.version, text: s.lines.join('\n').trim() }));
}

export function localChangelog(sideDir, pkg) {
  const dir = path.join(sideDir, 'node_modules', ...pkg.split('/'));
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((n) => /^(changelog|history|changes)(\.md)?$/i.test(n));
  if (!file) return { dir, file: null, text: null };
  return { dir, file: path.join(dir, file), text: readFileSync(path.join(dir, file), 'utf8') };
}

export function repoOf(sideDir, pkg) {
  try {
    const meta = JSON.parse(readFileSync(path.join(sideDir, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8'));
    const url = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url;
    return githubSlug(url || meta.homepage || '');
  } catch {
    return null;
  }
}

export function githubSlug(url) {
  const m = String(url).match(/github(?:\.com)?[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function ghFetch(url) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bumpgate',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return null;
  return res.json();
}

/** GitHub releases for versions in (from, to]; tags may be "v5.0.0" or "@scope/pkg@5.0.0". */
export async function githubReleases(slug, pkg, from, to, { pages = 3 } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const list = await ghFetch(`https://api.github.com/repos/${slug}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(list) || !list.length) break;
    for (const r of list) {
      const tag = String(r.tag_name || '');
      const at = tag.lastIndexOf('@');
      const tagPkg = at > 0 ? tag.slice(0, at) : null;
      const ver = at > 0 ? tag.slice(at + 1) : tag;
      if (tagPkg && tagPkg !== pkg) continue;
      if (inRange(ver.replace(/^v/, ''), from, to)) {
        out.push({ version: ver.replace(/^v/, ''), url: r.html_url, text: `## ${tag}\n${r.body || ''}`.trim() });
      }
    }
    if (list.length < 100) break;
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Breaking changes are announced in each new major's x.0.0 release, the oldest entry in a
 * newest-first list, so it is the first thing the size cap would drop. Put those first.
 */
export function majorFirst(releases) {
  const isMajor = (r) => /^\d+\.0\.0$/.test(String(r.version));
  return [...releases.filter(isMajor), ...releases.filter((r) => !isMajor(r))];
}

/** Everything the agent should read about one bump, capped to `maxChars`. */
export async function releaseNotes({ name, from, to }, sideDir, { maxChars = 14000, network = true } = {}) {
  const parts = [];
  const links = [];
  const local = localChangelog(sideDir, name);
  if (local?.text) {
    const secs = majorFirst(sliceChangelog(local.text, from, to));
    if (secs.length) parts.push(...secs.map((s) => s.text));
  }
  const slug = repoOf(sideDir, name);
  if (network && slug && parts.join('').length < maxChars / 2) {
    try {
      const rel = majorFirst(await githubReleases(slug, name, from, to));
      for (const r of rel) {
        links.push(r.url);
        parts.push(r.text);
      }
    } catch { /* offline is fine */ }
  }
  if (slug) links.unshift(`https://github.com/${slug}`);
  let text = parts.join('\n\n---\n\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n\n…(truncated)';
  return { name, from, to, repo: slug, links, text, empty: !text.trim() };
}
