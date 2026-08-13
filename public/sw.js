// Bumped so the fixed fetch handler replaces the installed one and the stale
// cache (which holds the index.html that was shadowing /__/auth/) is dropped.
const CACHE_NAME = 'second-brain-v45';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Handle the UPDATE button: app sends SKIP_WAITING to activate the new SW
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
    .then(() => self.clients.claim())
    .then(() =>
      self.clients.matchAll({ type: 'window' }).then((clients) =>
        clients.forEach((client) => client.navigate(client.url))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/.netlify/')) return;

  // Firebase's sign-in handler lives under /__/auth/ and MUST reach the network.
  // It arrives as a navigation request, so the branch below was handing Google's
  // redirect a cached index.html instead: the handler never ran, no credential was
  // ever stored, and getRedirectResult came back empty — the app reloaded looking
  // signed out. This is why Google sign-in failed in the installed PWA but not in
  // a normal browser tab, where no service worker is in the way.
  if (url.pathname.startsWith('/__/')) return;

  // API calls must not be served from the cache either, or Moodle and share
  // responses go stale.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (page loads, share target activations) — serve index.html
  // so query params (title, url, text) are preserved for the React app to read.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Assets — cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
