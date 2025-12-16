const CACHE_NAME = 'yashai-v2';

// Add the files you want to cache immediately
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/index.tsx',
  '/App.tsx',
  '/types.ts',
  '/metadata.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
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
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests that aren't modules we want to cache (like esm.sh)
  // and skip API calls to Google GenAI
  const url = new URL(event.request.url);
  
  // Don't cache the API calls (WebSocket/HTTP for GenAI)
  if (url.hostname.includes('googleapis') || url.hostname.includes('google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        // Check if we received a valid response
        if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          // Cache requests to our origin and esm.sh
          if (url.origin === self.location.origin || url.hostname === 'esm.sh' || url.hostname === 'cdn.tailwindcss.com') {
             cache.put(event.request, responseToCache);
          }
        });

        return response;
      });
    })
  );
});