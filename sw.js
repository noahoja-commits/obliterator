/* The Obliterator — service worker
   Strategy:
     · app shell  -> cache-first, refreshed in the background
     · fonts      -> stale-while-revalidate (works offline after first load)
     · /api/*     -> never cached, always network (AI calls must be live)
   Bump CACHE when you deploy or clients will keep the old shell. */

const CACHE = 'obliterator-v8';

// NB: never cache './index.html' — vercel.json sets cleanUrls, so that path
// 308s to './'. cache.add() would store a redirected response, and answering a
// navigation with one makes respondWith throw. './' is the canonical entry.
const SHELL = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is atomic — one 404 kills the whole install, so add individually
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                     // POSTs to the AI proxy pass straight through

  const url = new URL(req.url);

  // never cache model calls
  if (url.pathname.startsWith('/api/') || url.hostname.endsWith('anthropic.com')) return;

  // Google Fonts: serve cached copy immediately, refresh behind the scenes
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(req);
        const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // same-origin shell: cache first, then update
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
          return r;
        }).catch(() => hit || caches.match('./'));
        return hit || net;
      })
    );
  }
});

// let the page trigger an immediate update
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
