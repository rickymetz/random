/* Cadence — offline shell.
 *
 * Stale-while-revalidate: the app opens instantly from cache (including with
 * no signal at all, which is the point in a basement gym), and a fresh copy is
 * fetched in the background for next time. Bump CACHE to force a refresh.
 */
var CACHE = 'cadence-v2';
var SHELL = [
  './',
  'index.html',
  'styles.css',
  'routine.js',
  'figures.js',
  'media.js',
  'store.js',
  'charts.js',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var network = fetch(request)
          .then(function (response) {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
