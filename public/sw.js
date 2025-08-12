// Very light cache for static assets
const CACHE = 'abl-v1';
const ASSETS = [
  '/', '/index.html', '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only cache GET requests for same-origin static files
  if (e.request.method === 'GET' && url.origin === location.origin && (url.pathname === '/' || url.pathname.startsWith('/index.html') || url.pathname.startsWith('/manifest.json'))) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
