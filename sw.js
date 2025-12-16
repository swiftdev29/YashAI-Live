const CACHE_NAME = 'yashai-v5';

// Only cache the absolute essentials.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
  // Note: We don't hardcode icon names here anymore to allow for flexible filenames,
  // they will be cached at runtime when requested.
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
  const url = new URL(event.request.url);
  
  // Don't cache API calls
  if (url.hostname.includes('googleapis') || url.hostname.includes('google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
          return response;
        }

        const responseToCache = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          // Runtime Caching: Cache local files and valid CDNs
          if (url.origin === self.location.origin || url.hostname === 'esm.sh' || url.hostname === 'cdn.tailwindcss.com') {
             cache.put(event.request, responseToCache);
          }
        });

        return response;
      });
    }).catch(() => {
      // Offline fallback could go here
    })
  );
});