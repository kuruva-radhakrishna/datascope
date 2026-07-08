'use strict';

// Plain node:http server for local dev and the Docker image.
// Serves /api/* via the shared router; if a frontend build exists it is
// served statically too (nginx does this in the final image instead).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// load .env for local runs (Vercel and Docker inject env directly)
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env — fine */ }

const { route, MAX_CSV_BYTES } = require('./lib/handlers.js');

const PORT = Number(process.env.PORT || 8090);
const DIST = path.join(__dirname, '..', 'frontend', 'dist');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_CSV_BYTES + 1024 * 512) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api')) {
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBody(req);
        if (raw) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        }
      }
      const query = Object.fromEntries(url.searchParams);
      const out = await route(req.method, url.pathname, body, query);
      if (out.raw !== undefined) {
        const headers = { 'content-type': out.contentType || 'text/plain' };
        if (out.filename) headers['content-disposition'] = `attachment; filename="${out.filename}"`;
        res.writeHead(out.status, headers);
        res.end(out.raw);
        return;
      }
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
      return;
    }

    // static frontend (dev convenience / image fallback)
    if (fs.existsSync(DIST)) {
      let filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!filePath.startsWith(DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST, 'index.html'); // SPA fallback
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found (frontend not built yet — run the Vite dev server on 9080)' }));
  } catch (err) {
    const status = err.statusCode || 500;
    console.error(`${req.method} ${url.pathname} failed:`, err.message);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: status === 413 ? 'payload too large (4MB cap)' : 'internal error: ' + err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`DataScope backend listening on http://localhost:${PORT}`);
});
