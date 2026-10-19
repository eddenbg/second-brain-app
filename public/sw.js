const CACHE_NAME = 'second-brain-v49';
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

// Fetch the fresh copy and keep it for offline use; use the cached one if the
// network fails or takes longer than `timeoutMs`.
function networkFirst(cacheKey, timeoutMs) {
  const fresh = fetch(cacheKey, { cache: 'no-cache' }).then((response) => {
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
    }
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([fresh, timeout.then(() => caches.match(cacheKey))])
    .then((response) => response || fresh)
    .catch(() => caches.match(cacheKey).then((cached) => cached || fresh));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/.netlify/')) return;
  // App API (cloud storage, Moodle): always live, never cached
  if (url.pathname.startsWith('/api/')) return;
  // Firebase Auth helper pages (Google sign-in redirect) must hit the network
  if (url.pathname.startsWith('/__/')) return;

  // Navigation requests (page loads, share target activations) — serve index.html
  // so query params (title, url, text) are preserved for the React app to read.
  // Network first (so a new deploy shows up on the next open), falling back
  // to the cached copy when offline or the network is slow.
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst('./index.html', 4000));
    return;
  }
  // The manifest too, so home-screen / share-menu changes reach installed apps
  if (url.pathname.endsWith('/manifest.json')) {
    event.respondWith(networkFirst('./manifest.json', 4000));
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
