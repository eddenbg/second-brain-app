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
  const url = new URL(event.request.url);

  // First, check if this is a share target request.
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const clip = {
          title: formData.get('title') || 'Untitled',
          text: formData.get('text') || '',
          url: formData.get('url') || '',
        };

        const response = await fetch('/netlify/functions/addSharedClip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clip),
        });

        if (!response.ok) {
           console.error('Failed to save clip:', response.statusText);
        }
        
        // Redirect back to the main app after sharing is complete.
        return Response.redirect('/', 303);
      } catch (error) {
        console.error('Error in share target:', error);
        return Response.redirect('/', 303);
      }
    })());
  } else {
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
  }
});
