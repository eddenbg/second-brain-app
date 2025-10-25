// This is the service worker script.

const CACHE_NAME = 'second-brain-cache-v1';
// Add main app shell files to the cache.
const urlsToCache = [ '/', '/index.html' ];

// Listen for messages from the client (e.g., the 'Update Now' button).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // This command tells the new service worker to take over.
    self.skipWaiting();
  }
});

// The 'install' event fires when the browser sees a new version of the sw.js file.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Opened cache');
      return cache.addAll(urlsToCache);
    })
  );
});

// The 'activate' event fires when the new service worker is ready to take control.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        // Clean up old, unused caches.
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => {
      // Tell the service worker to take control of the page immediately.
      return self.clients.claim();
    })
  );
});

// The 'fetch' event intercepts all network requests.
self.addEventListener('fetch', (event) => {
  // For all other requests, use a "cache-first" strategy.
  event.respondWith(
    caches.match(event.request).then(response => {
      // If we have a copy in the cache, return it.
      if (response) {
        return response;
      }
      // Otherwise, fetch it from the network.
      return fetch(event.request);
    })
  );
});
