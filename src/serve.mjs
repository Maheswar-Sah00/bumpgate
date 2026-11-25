// Serve a built app on localhost: a tiny static server (SPA fallback) or the repo's own command.
import http from 'node:http';
import net from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { killTree, scrubEnv } from './sh.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.xml': 'application/xml',
};

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Static server with SPA fallback and an optional base path (e.g. "/app/"). */
export function serveStatic(rootDir, { port, spa = true, base = '/' } = {}) {
  const root = path.resolve(rootDir);
  const baseNorm = ('/' + String(base).replace(/^\/+|\/+$/g, '') + '/').replace(/^\/\/$/, '/');
  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (baseNorm !== '/' && urlPath === baseNorm.slice(0, -1)) {
        res.writeHead(301, { Location: baseNorm });
        return res.end();
      }
      if (baseNorm !== '/' && urlPath.startsWith(baseNorm)) urlPath = '/' + urlPath.slice(baseNorm.length);
      let file = path.join(root, path.normalize(urlPath).replace(/^([/\\])+/, ''));
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!existsSync(file)) {
        const htmlTry = file + '.html';
        if (existsSync(htmlTry)) file = htmlTry;
        else if (spa && !path.extname(urlPath)) file = path.join(root, 'index.html');
      }
      if (!existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://localhost:${port}${baseNorm}`,
        port,
        stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

/** Start the repo's own server command with PORT set, and wait until it answers. */
export async function serveCommand(command, { cwd, port, path: urlPath = '/', env = {}, readyTimeoutMs = 120000 } = {}) {
  const cmd = command.replace(/\$PORT|\$\{PORT\}|%PORT%/g, String(port));
  const child = spawn(cmd, {
    cwd,
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: { ...scrubEnv(), PORT: String(port), BROWSER: 'none', CI: 'true', ...env },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; if (log.length > 20000) log = log.slice(-20000); });
  child.stderr.on('data', (d) => { log += d; if (log.length > 20000) log = log.slice(-20000); });
  const url = `http://localhost:${port}${urlPath.startsWith('/') ? urlPath : '/' + urlPath}`;
  const ok = await waitForHttp(url, readyTimeoutMs, () => child.exitCode !== null);
  if (!ok) {
    killTree(child.pid);
    throw new Error(`server did not answer on ${url} within ${Math.round(readyTimeoutMs / 1000)}s.\n${log.slice(-2000)}`);
  }
  return {
    url,
    port,
    stop: async () => {
      killTree(child.pid);
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

export async function waitForHttp(url, timeoutMs = 60000, gaveUp = () => false) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (gaveUp()) return false;
    const status = await probe(url);
    if (status && status < 500) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

// A dev server may listen on IPv4 or IPv6 only (Vite on Windows binds `localhost` to ::1), while
// the browser Kane drives tries both. Probe both, or a running server looks dead.
async function probe(url) {
  if (!url.includes('://localhost')) return probeOne(url);
  return (await probeOne(url.replace('://localhost', '://127.0.0.1'))) ?? probeOne(url.replace('://localhost', '://[::1]'));
}

function probeOne(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}
