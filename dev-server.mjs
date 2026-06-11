// Local dev: serves public/ and mounts api/items.js with the in-memory store.
// Usage: npm run dev → http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from './api/items.js';
import statsHandler from './api/stats.js';
import liveHandler from './api/live.js';

const API = { '/api/items': handler, '/api/stats': statsHandler, '/api/live': liveHandler };
const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (API[url.pathname]) {
    // Shim the Vercel Node function conveniences.
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    req.query = Object.fromEntries(url.searchParams);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    return API[url.pathname](req, res);
  }

  const path = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  try {
    const data = await readFile(join('public', path));
    res.setHeader('content-type', MIME[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(PORT, () => console.log(`rapid-reader dev → http://localhost:${PORT}`));
