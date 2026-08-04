const CACHE_NAME = 'tarjeta-clara-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './supabase-sync.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cache or fetch network
        return response || fetch(event.request);
      })
  );
});
