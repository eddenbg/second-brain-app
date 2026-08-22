// Bumped because manifest.json is now also network-first (see the fetch
// handler below) — this bump is what actually delivers that fix to devices
// that already have a service worker installed, since without it nothing
// tells an existing worker to re-run its install/activate step at all.
const CACHE_NAME = 'second-brain-v47';
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

  // manifest.json, network-first, for the same reason as index.html above.
  // This one bit harder: the cache-first path below meant a manifest.json
  // change (e.g. the commit that first added share_target) could never reach
  // an already-installed device at all — manifest.json isn't a navigation
  // request, so it never got the network-first treatment, and uninstalling
  // the home-screen shortcut doesn't clear this cache or unregister this
  // worker, both of which live in the browser's site data for this origin,
  // not in the shortcut/WebAPK wrapper. A "remove icon, reinstall" on the
  // same browser therefore reran the install against the exact same stale
  // cache, silently carrying the old manifest forward every time.
  if (url.pathname.endsWith('/manifest.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
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
