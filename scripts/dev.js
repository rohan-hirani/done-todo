// Local dev server: serves /public and /api/* and, with an in-memory task store
// (unless BLOB_READ_WRITE_TOKEN is set) so you can try everything offline.
//   npm run dev        ->  http://localhost:3000   (passcode: "dev")
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

process.env.APP_PASSCODE = process.env.APP_PASSCODE || 'dev';
process.env.DONE_DEV = process.env.BLOB_READ_WRITE_TOKEN ? '' : '1';   // in-memory store unless a Blob token is set

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
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
}).listen(PORT, () => console.log(`Done dev server on http://localhost:${PORT} (passcode: ${process.env.APP_PASSCODE})`));
