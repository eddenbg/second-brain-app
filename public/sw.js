// Bumped to evict the stale app shell one last time. From here on the shell is
// fetched network-first, so a deploy no longer depends on this string changing
// to actually reach an installed device.
const CACHE_NAME = 'second-brain-v46';
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

  // Navigation requests (page loads, share target activations) — network first.
  //
  // This used to answer from the cache unconditionally. Because index.html names
  // the content-hashed JS bundle, a cached shell pinned the app to whichever
  // build was current when that cache was written, and every later deploy was
  // invisible until CACHE_NAME happened to change. Shipping a fix was therefore
  // not enough for it to reach an installed device.
  //
  // Going to the network first means an online launch always gets the newest
  // build; the cache is refreshed behind it and still answers when offline, so
  // the share target keeps working with no connection.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
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
