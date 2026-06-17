// Minimal service worker: makes the app installable and loadable offline.
// Network-first so deploys show up immediately; cache is the fallback.
// Bump CACHE (and the ?v= on app.js/style.css in index.html) on every deploy so
// a new service worker installs, the old precache is dropped, and clients get
// the fresh shell instead of a stale one.
const CACHE = 'rr-v10';
const SHELL = ['/', '/app.js?v=20260617a', '/rsvp.js', '/parse.js', '/epub.js', '/icons.js', '/style.css?v=20260617a', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // the share-target navigation (/?text=…) must never be cached; everything else
  // (incl. the ?v=-versioned assets) is cached network-first for offline use
  const isShare = url.pathname === '/' && !!url.search;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && !isShare) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.pathname === '/' }))
  );
});
