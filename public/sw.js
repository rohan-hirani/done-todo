const VERSION = 'done-v5';
const CDN = 'done-cdn-v1';   // Transformers.js + onnx wasm from jsdelivr, kept across app versions for offline voice
const SHELL = ['/', '/styles.css?v=5', '/app.js?v=5', '/fx.js', '/sound.js', '/nlp.js', '/voice.js', '/stt-worker.js?v=4', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== CDN).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'GET' && url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(CDN).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // Network first (fresh deploys), fall back to the cached shell when offline.
    e.respondWith(
      fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); return r; })
        .catch(() => caches.match('/'))
    );
    return;
  }
  // Stale-while-revalidate for static assets.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
      return hit || net;
    })
  );
});
