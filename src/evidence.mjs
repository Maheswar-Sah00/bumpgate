// Read what Kane saw from a sealed evidence pack: the failed step, its screenshot,
// console errors and failed network requests. Defensive: unknown shapes are skipped.
import { openZip } from './zip.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const IGNORED_URLS = /favicon\.ico|\/__vite_ping|hot-update|sockjs-node|\/@vite\/client|google-analytics|googletagmanager|doubleclick|hotjar|sentry\.io/i;

export function readPack(packPath) {
  const zip = openZip(packPath);
  const names = zip.names();
  const testDirs = [...new Set(names.map((n) => n.match(/^tests\/([^/]+)\//)).filter(Boolean).map((m) => m[1]))];

  const consoleErrors = [];
  const networkErrors = [];
  const steps = [];
  let failure = null;

  for (const n of names) {
    if (/\/logs\/\d+-console\.ndjson$/.test(n)) {
      for (const line of (zip.text(n) || '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          const level = String(ev.level ?? ev.type ?? ev.severity ?? ev.kind ?? '').toLowerCase();
          if (/error|exception|uncaught/.test(level) || ev.exception || ev.exceptionDetails) {
            const text = ev.text ?? ev.message ?? ev.msg ?? (ev.exceptionDetails && (ev.exceptionDetails.text || ev.exceptionDetails.exception?.description))
              ?? (Array.isArray(ev.args) ? ev.args.map(String).join(' ') : null);
            if (text && !IGNORED_URLS.test(String(text))) consoleErrors.push(String(text).slice(0, 500));
          }
        } catch { /* not JSON */ }
      }
    }
    if (/\/logs\/\d+-network\.har$/.test(n)) {
      try {
        const har = JSON.parse(zip.text(n) || '{}');
        for (const e of har?.log?.entries || []) {
          const status = e?.response?.status;
          const url = e?.request?.url || '';
          if ((status >= 400 || status === 0) && !IGNORED_URLS.test(url) && !/^data:/.test(url)) {
            networkErrors.push({ status, method: e?.request?.method || 'GET', url: url.slice(0, 300) });
          }
        }
      } catch { /* bad HAR */ }
    }
    const sm = n.match(/^tests\/([^/]+)\/steps\/(\d+)-([^/]+)\/step\.json$/);
    if (sm) {
      try {
        const step = JSON.parse(zip.text(n));
        steps.push({ test: sm[1], ordinal: Number(sm[2]), id: sm[3], ...pickStep(step) });
      } catch { /* ignore */ }
    }
  }

  steps.sort((a, b) => a.ordinal - b.ordinal);

  // Kane 0.10 writes steps/<ordinal>-<id>/screenshot.jpg; accept png too, and sort by ordinal, not as text.
  const failureNames = names.filter((n) => /\/steps\/\d+-[^/]+\/failure\.yaml$/.test(n)).sort(byOrdinal);
  const runFailure = zip.has('failure.yaml') ? zip.text('failure.yaml') : null;
  if (failureNames.length) {
    const fn = failureNames[0];
    const dir = fn.replace(/failure\.yaml$/, '');
    const shot = ['annotated.png', 'annotated.jpg', 'annotated.jpeg', 'screenshot.png', 'screenshot.jpg', 'screenshot.jpeg']
      .map((f) => dir + f).find((p) => zip.has(p)) || null;
    failure = { entry: fn, text: (zip.text(fn) || '').slice(0, 4000), screenshot: shot };
  } else if (runFailure && /\S/.test(runFailure) && !/^\s*(failures:\s*\[\]|\{\})\s*$/m.test(runFailure)
    && !/^\s*failures:\s*0\b/m.test(runFailure)) {
    failure = { entry: 'failure.yaml', text: runFailure.slice(0, 4000), screenshot: null };
  }

  const shots = names.filter((n) => /\/steps\/\d+-[^/]+\/screenshot\.(png|jpe?g)$/i.test(n)).sort(byOrdinal);
  const status = packStatus(zip, names);

  return {
    path: packPath,
    status,
    tests: testDirs,
    steps,
    failure,
    consoleErrors: dedupe(consoleErrors),
    networkErrors: dedupeNet(networkErrors),
    screenshots: shots,
    lastScreenshot: shots.length ? shots[shots.length - 1] : null,
    extract(entry, toFile) {
      const data = zip.read(entry);
      if (!data) return null;
      mkdirSync(path.dirname(toFile), { recursive: true });
      writeFileSync(toFile, data);
      return toFile;
    },
  };
}

function byOrdinal(a, b) {
  const o = (n) => Number((n.match(/\/steps\/(\d+)-/) || [])[1] ?? 0);
  return o(a) - o(b) || a.localeCompare(b);
}

/**
 * The test's outcome. run.yaml's own `status` is the pack's state (`finalized`), not the test's,
 * so read tests/<t>/result.yaml first, then run.yaml's totals.
 */
function packStatus(zip, names) {
  const results = names.filter((n) => /^tests\/[^/]+\/result\.yaml$/.test(n))
    .map((n) => (zip.text(n).match(/^status:\s*['"]?(\w+)/m) || [])[1]).filter(Boolean);
  if (results.length) return results.includes('failed') ? 'failed' : results.includes('broken') ? 'broken' : results[0];
  const runYaml = zip.text('run.yaml') || '';
  const count = (k) => Number((runYaml.match(new RegExp(`^\\s+${k}:\\s*(\\d+)`, 'm')) || [])[1] ?? NaN);
  if (count('failed') > 0) return 'failed';
  if (count('broken') > 0) return 'broken';
  if (count('passed') > 0) return 'passed';
  return (runYaml.match(/^status:\s*['"]?(\w+)/m) || [])[1] || null;
}

function pickStep(s) {
  return {
    status: s.status ?? s.result ?? null,
    title: s.title ?? s.heading ?? s.objective ?? s.name ?? null,
    summary: s.summary ?? s.reason ?? s.one_liner ?? null,
  };
}

function dedupe(list) {
  return [...new Set(list)];
}

function dedupeNet(list) {
  const seen = new Set();
  return list.filter((n) => {
    const k = `${n.status} ${n.method} ${n.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
