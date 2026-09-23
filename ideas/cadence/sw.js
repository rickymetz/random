/* Cadence — offline shell.
 *
 * Two rules the previous version got wrong, both of them the kind that only
 * show up after you ship:
 *
 * 1. CacheStorage is scoped to the *origin*, not to the service worker's
 *    scope. Deleting "every cache that isn't mine" therefore deleted the
 *    offline shell of every other app published under the same domain. Only
 *    caches this app owns are touched now.
 *
 * 2. cache.addAll() goes through the HTTP cache, so bumping CACHE fetched the
 *    files again from the browser's own cache and filled the shiny new cache
 *    with stale copies — an update could take the CDN's max-age to arrive, or
 *    never. The shell is fetched with {cache:'reload'} to bypass that, and is
 *    then served cache-first from the versioned cache. Cache-first matters:
 *    revalidating file by file could leave a *mixed* shell (new app.js, old
 *    figures.js) cached indefinitely, which no later request would repair.
 *    A version is now all-or-nothing.
 */
var CACHE = 'cadence-v6';

/* Without every one of these the app is broken, so the install fails and the
 * browser retries rather than leaving a half-built cache in place. */
var CORE = [
  './',
  'index.html',
  'styles.css',
  'routine.js',
  'figures.js',
  'media.js',
  'store.js',
  'charts.js',
  'app.js'
];

/* Nice to have offline; a missing one is not worth failing an install over. */
var OPTIONAL = [
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

function reload(url) {
  return new Request(url, { cache: 'reload' });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(CORE.map(reload)).then(function () {
        return Promise.all(OPTIONAL.map(function (url) {
          return cache.add(reload(url)).catch(function () { /* best effort */ });
        }));
      });
    })
    // No skipWaiting: an update that swaps itself in mid-session is invisible
    // to the person using it. The page offers it instead (see app.js).
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          var ours = key.indexOf('cadence-') === 0;
          return ours && key !== CACHE ? caches.delete(key) : null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* The hub's files (nav.js, ideas.json) live outside this scope and change
   * on the hub's schedule, not Cadence's: never pin them in this versioned
   * cache. Network first; offline, whatever copy the hub worker holds
   * (caches.match searches every cache on the origin, read-only). */
  if (url.href.indexOf(self.registration.scope) !== 0) {
    event.respondWith(fetch(request).catch(function () {
      return caches.match(request, { ignoreSearch: true }).then(function (hit) {
        return hit || new Response('', { status: 504, statusText: 'Offline' });
      });
    }));
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;

        // A link with a query string, or one shared from elsewhere, is still
        // this app — serve the shell rather than failing offline.
        if (request.mode === 'navigate') {
          return cache.match('./').then(function (shell) {
            return shell || fetch(request).catch(function () {
              return new Response('', { status: 504, statusText: 'Offline' });
            });
          });
        }

        return fetch(request).then(function (response) {
          if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(function () {
          return new Response('', { status: 504, statusText: 'Offline' });
        });
      });
    })
  );
});
