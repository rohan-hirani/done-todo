// Local dev server: serves /public and /api/* and, unless SUPABASE_URL is set,
// an in-memory fake of Supabase's REST API so you can try everything offline.
//   npm run dev        ->  http://localhost:3000   (passcode: "dev")
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

process.env.APP_PASSCODE = process.env.APP_PASSCODE || 'dev';
const mock = !process.env.SUPABASE_URL;
if (mock) {
  process.env.SUPABASE_URL = `http://localhost:${PORT}/__mock`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock';
}
let rows = [];

function mockRest(req, res, url, body) {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const eq = (url.searchParams.get('id') || '').replace('eq.', '');
  const fill = (r) => ({ id: crypto.randomUUID(), done: false, done_at: null, created_at: new Date().toISOString(), source: 'app', ...r });
  if (req.method === 'GET') return send(200, rows);
  if (req.method === 'POST') {
    const b = JSON.parse(body || '{}');
    const i = rows.findIndex((r) => r.id === b.id);
    if (i >= 0) { rows[i] = { ...rows[i], ...b }; return send(201, [rows[i]]); }
    const r = fill(b); rows.push(r); return send(201, [r]);
  }
  if (req.method === 'PATCH') {
    const i = rows.findIndex((r) => r.id === eq);
    if (i < 0) return send(200, []);
    rows[i] = { ...rows[i], ...JSON.parse(body) }; return send(200, [rows[i]]);
  }
  if (req.method === 'DELETE') { rows = rows.filter((r) => r.id !== eq); return send(204, null); }
  send(405, {});
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (url.pathname.startsWith('/__mock/rest/v1/')) return mockRest(req, res, url, body);
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
      const file = path.join(__dirname, '..', 'api', name + '.js');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('{}'); }
      req.query = Object.fromEntries(url.searchParams);
      try { req.body = body ? JSON.parse(body) : undefined; } catch { req.body = undefined; }
      return require(file)(req, res);
    }
    let p = path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!p.startsWith(PUB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
}).listen(PORT, () => console.log(`Done dev server on http://localhost:${PORT} (passcode: ${process.env.APP_PASSCODE})${mock ? ' [mock db]' : ''}`));
