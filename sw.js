
const CACHE_NAME = 'second-brain-v5';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/index.tsx'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// The fetch handler is required for the "Install" button to appear.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Special handling for shared data
  if (event.request.method === 'GET' && 
      (url.searchParams.has('url') || url.searchParams.has('title') || url.searchParams.has('text'))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Strategy: Network first, then Cache
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
      .then((response) => response || caches.match('/'))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
