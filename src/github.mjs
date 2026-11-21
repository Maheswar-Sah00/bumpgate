// GitHub through the REST API (token from GITHUB_TOKEN / GH_TOKEN). No SDK.
import { readFileSync } from 'node:fs';
import { MARKER } from './comment.mjs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

export async function gh(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bumpgate',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${route} → ${res.status}: ${typeof data === 'object' ? data?.message : String(data).slice(0, 200)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Create or update the single Bumpgate comment on a PR. */
export async function upsertComment(repo, pr, body) {
  const comments = await gh('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100`);
  const mine = (comments || []).find((c) => typeof c.body === 'string' && c.body.includes(MARKER));
  if (mine) return gh('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body });
  return gh('POST', `/repos/${repo}/issues/${pr}/comments`, { body });
}

export const LABELS = {
  'bumpgate: green': { color: '2da44e', description: 'Kane: every journey still passes' },
  'bumpgate: amber': { color: 'd4a72c', description: 'Kane: works, but the UI changed' },
  'bumpgate: red': { color: 'cf222e', description: 'Kane: a journey broke on this bump' },
  'bumpgate: fixed': { color: '1f883d', description: 'Agent migrated, Kane re-verified' },
  'needs-human': { color: 'b60205', description: 'Bumpgate could not fix this bump' },
};

export async function setLabels(repo, pr, wanted) {
  for (const name of wanted) {
    const meta = LABELS[name] || { color: '8c8c8c', description: '' };
    try {
      await gh('POST', `/repos/${repo}/labels`, { name, color: meta.color, description: meta.description });
    } catch (e) {
      if (e.status !== 422) throw e; // 422 = already exists
    }
  }
  const current = (await gh('GET', `/repos/${repo}/issues/${pr}/labels`)).map((l) => l.name);
  for (const name of current) {
    if (name in LABELS && !wanted.includes(name)) {
      await gh('DELETE', `/repos/${repo}/issues/${pr}/labels/${encodeURIComponent(name)}`).catch(() => {});
    }
  }
  if (wanted.length) await gh('POST', `/repos/${repo}/issues/${pr}/labels`, { labels: wanted });
}

/** Enable auto-merge (GraphQL); if the repo does not allow it, merge directly when clean. */
export async function mergeWhenGreen(repo, pr, { method = 'SQUASH' } = {}) {
  const info = await gh('GET', `/repos/${repo}/pulls/${pr}`);
  try {
    await gh('POST', '/graphql', {
      query: 'mutation($id:ID!,$m:PullRequestMergeMethod!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$m}){pullRequest{number}}}',
      variables: { id: info.node_id, m: method },
    }).then((r) => {
      if (r?.errors?.length) throw new Error(r.errors.map((e) => e.message).join('; '));
    });
    return 'auto-merge enabled';
  } catch (e) {
    // "Pull request is in clean status" (nothing pending) or auto-merge disabled: merge now.
    await gh('PUT', `/repos/${repo}/pulls/${pr}/merge`, { merge_method: method.toLowerCase(), sha: info.head.sha });
    return 'merged';
  }
}

/**
 * Upload files to an orphan `bumpgate-evidence` branch in one commit, so PR comments can embed
 * screenshots and link evidence packs. Returns {path: rawUrl}.
 */
export async function uploadEvidence(repo, files, { branch = 'bumpgate-evidence', message = 'Bumpgate evidence' } = {}) {
  let parent = null;
  let baseTree = null;
  try {
    const ref = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`);
    parent = ref.object.sha;
    baseTree = (await gh('GET', `/repos/${repo}/git/commits/${parent}`)).tree.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const tree = [];
  if (!parent) {
    tree.push({ path: 'README.md', mode: '100644', type: 'blob', content: '# Bumpgate evidence\n\nScreenshots and Kane CLI evidence packs linked from Bumpgate PR comments.\n' });
  }
  for (const [dest, src] of Object.entries(files)) {
    const blob = await gh('POST', `/repos/${repo}/git/blobs`, { content: readFileSync(src).toString('base64'), encoding: 'base64' });
    tree.push({ path: dest, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh('POST', `/repos/${repo}/git/trees`, baseTree ? { base_tree: baseTree, tree } : { tree });
  const commit = await gh('POST', `/repos/${repo}/git/commits`, { message, tree: newTree.sha, parents: parent ? [parent] : [] });
  if (parent) await gh('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  else await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  const out = {};
  for (const dest of Object.keys(files)) out[dest] = `https://raw.githubusercontent.com/${repo}/${commit.sha}/${dest}`;
  return out;
}

/** Kane's public evidence viewer reads a pack straight from a URL. */
export function viewerUrl(packUrl) {
  return `https://evidence.lambdatest.com/?pack=${encodeURIComponent(packUrl)}`;
}
