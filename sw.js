/* random — hub service worker.
 *
 * GENERATED: scripts/build.js writes /sw.js from scripts/sw.template.js,
 * stamping VERSION with a hash of the shell and the idea list. Edit the
 * template, not sw.js.
 *
 * Scope is the hub root. What it does:
 *   - precaches the hub shell (homepage, nav.js, offline page, icons…),
 *     all-or-nothing and cache-first, so a version is never mixed;
 *   - caches each idea the first time it is opened (network-first pages,
 *     stale-while-revalidate for the rest), capped at ~50 MB with the least
 *     recently used idea evicted first;
 *   - injects nav.js into idea pages, so every idea gets the bottom navbar;
 *   - keeps ideas saved for offline ("pinned", from the hub's Save button,
 *     or tiny ideas saved at install) out of eviction;
 *   - leaves apps with their own worker (Cadence, Ledger) strictly alone.
 *
 * CacheStorage is per origin, not per worker scope: this worker only ever
 * creates or deletes caches named random-hub-*. (Cadence learnt this the
 * hard way — see ideas/cadence/sw.js.)
 */
'use strict';

var VERSION = "a88f7f01c90e";
var SHELL = ["./","manifest.webmanifest","ideas.json","nav.js","hub.js","retro.js","retro.css","fonts/DroidSans.woff2","fonts/DroidSans-Bold.woff2","offline.html","icon.svg","icon-192.png","icon-512.png","icon-maskable-512.png","apple-touch-icon.png"];
// Each shell file's content hash: an update re-downloads only what changed.
var SHELL_HASH = {"./":"7e57af26069dd9bd","manifest.webmanifest":"97bebb0715ee98f4","ideas.json":"8635cd815e4af00d","nav.js":"849ab7ecd5953854","hub.js":"5a3d5eb2b3195a02","retro.js":"047d675a88dfce4d","retro.css":"88886dd026da685f","fonts/DroidSans.woff2":"926eda9203636949","fonts/DroidSans-Bold.woff2":"b0f41617595b98bc","offline.html":"071764cae7779a82","icon.svg":"dfd5d5d474b00876","icon-192.png":"5a00e993c9494d3c","icon-512.png":"3d81a80b70f5bfd5","icon-maskable-512.png":"2e07cd24516fee62","apple-touch-icon.png":"f3a5e4309c27b078"};
// Ideas small enough to save whole at install: [{ slug, paths }], where
// "ideas/<slug>/" stands for its index.html (the URL a visit requests).
var AUTO_SAVE = [{"slug":"breathe","paths":["ideas/breathe/"]}];

var PREFIX = 'random-hub-';
var SHELL_CACHE = PREFIX + 'shell-' + VERSION;
var IDEAS_CACHE = PREFIX + 'ideas';
var INDEX_KEY = '__random-hub-index__';
var CAP_BYTES = 50 * 1024 * 1024;
var MAX_ENTRY_BYTES = 20 * 1024 * 1024;

var SCOPE = self.registration.scope; // e.g. https://host/random/
var HANDS_OFF = ['ideas/cadence/', 'ledger/', 'dossier/'];

function at(path) { return new URL(path, SCOPE).href; }
function reload(url) { return new Request(at(url), { cache: 'reload' }); }

/* -------------------------------------------------------------- lifecycle */

self.addEventListener('install', function (event) {
  event.waitUntil(
    installShell().then(autoSave)
    // No skipWaiting here: the page offers the update as a toast and sends
    // SKIP_WAITING when the person taps Refresh.
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          var oldShell = key.indexOf(PREFIX + 'shell-') === 0 && key !== SHELL_CACHE;
          return oldShell ? caches.delete(key) : null;
        }));
      })
      .then(reconcileIndex)
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  var msg = event.data || {};
  var port = event.ports && event.ports[0];
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  else if (msg.type === 'STATUS' && port) event.waitUntil(status().then(function (s) { port.postMessage(s); }));
  else if (msg.type === 'PIN' && msg.slug) {
    event.waitUntil(pin(msg.slug, !!msg.on).then(status).then(function (s) { if (port) port.postMessage(s); }));
  }
  else if (msg.type === 'CLEAR_CACHED') {
    event.waitUntil(clearUnpinned().then(status).then(function (s) { if (port) port.postMessage(s); }));
  }
});

/* ------------------------------------------------------ saved for offline */

// Which ideas are pinned (kept out of eviction) and which have any copy.
function status() {
  return caches.open(IDEAS_CACHE).then(loadIndex).then(function (index) {
    var cached = {};
    Object.keys(index.entries).forEach(function (u) { cached[index.entries[u].slug] = true; });
    return { type: 'STATUS', saved: Object.keys(index.pinned || {}), cached: Object.keys(cached), version: VERSION };
  });
}

function pin(slug, on) {
  return serial(function () {
    return caches.open(IDEAS_CACHE).then(function (cache) {
      return loadIndex(cache).then(function (index) {
        index.pinned = index.pinned || {};
        if (on) index.pinned[slug] = true;
        else delete index.pinned[slug];
        index.used[slug] = Date.now();
        return saveIndex(cache, index);
      });
    });
  });
}

// The shell, all-or-nothing: a file whose hash matches a copy in an older
// shell cache is reused from there; everything else is fetched past the
// HTTP cache. (A deploy that only adds an idea re-downloads the homepage and
// ideas.json, not the fonts and the launcher.)
function installShell() {
  return caches.keys().then(function (keys) {
    // Any shell cache may hold an identical file, this version's included
    // (a re-install after a failed attempt, or a worker-only change).
    var olds = keys.filter(function (k) { return k.indexOf(PREFIX + 'shell-') === 0; });
    return caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (path) {
        var hash = SHELL_HASH[path];
        return reusable(olds, path, hash).then(function (hit) {
          if (hit) return cache.put(at(path), hit);
          return fetch(reload(path)).then(function (res) {
            if (!res.ok) throw new Error('precache failed: ' + path + ' ' + res.status);
            return res.blob().then(function (body) {
              var headers = new Headers(res.headers);
              headers.set('x-random-hash', hash);
              return cache.put(at(path), new Response(body, { status: res.status, statusText: res.statusText, headers: headers }));
            });
          });
        });
      }));
    });
  });
}
function reusable(olds, path, hash) {
  return olds.reduce(function (found, name) {
    return found.then(function (hit) {
      if (hit) return hit;
      return caches.open(name).then(function (c) { return c.match(at(path)); }).then(function (r) {
        return r && r.headers.get('x-random-hash') === hash ? r : null;
      });
    });
  }, Promise.resolve(null));
}

// Settings → Storage → "Clear cached ideas": drop every idea not saved for
// offline.
function clearUnpinned() {
  return serial(function () {
    return caches.open(IDEAS_CACHE).then(function (cache) {
      return loadIndex(cache).then(function (index) {
        var doomed = Object.keys(index.entries).filter(function (u) { return !index.pinned[index.entries[u].slug]; });
        doomed.forEach(function (u) { delete index.entries[u]; });
        Object.keys(index.used).forEach(function (s) { if (!index.pinned[s]) delete index.used[s]; });
        return Promise.all(doomed.map(function (u) { return cache.delete(u); }))
          .then(function () { return saveIndex(cache, index); });
      });
    });
  });
}

// Best effort: an install never fails over an idea it merely hoped to save.
function autoSave() {
  return Promise.all(AUTO_SAVE.map(function (idea) {
    return Promise.all(idea.paths.map(function (path) {
      var request = reload(path);
      return fetch(request).then(function (response) {
        if (cacheable(response)) return store(new Request(at(path)), response, idea.slug);
      }).catch(function () {});
    })).then(function () { return pin(idea.slug, true); });
  })).catch(function () {});
}

/* ------------------------------------------------------------------ fetch */

function relPath(url) {
  return url.href.indexOf(SCOPE) === 0 ? url.href.slice(SCOPE.length).split(/[?#]/)[0] : null;
}

function ideaSlug(rel) {
  var m = /^ideas\/([^/]+)\//.exec(rel);
  return m ? m[1] : null;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  var rel = relPath(url);
  if (rel === null) return;
  for (var i = 0; i < HANDS_OFF.length; i++) {
    if (rel.indexOf(HANDS_OFF[i]) === 0) return;
  }

  // The hub shell: cache-first from this version's precache.
  if (rel === '' || rel === 'index.html' || SHELL.indexOf(rel) !== -1) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(function (cache) {
        return cache.match(rel === 'index.html' ? at('./') : request, { ignoreSearch: true })
          .then(function (hit) { return hit || fetch(request); });
      })
    );
    return;
  }

  var slug = ideaSlug(rel);
  if (!slug) return; // anything else under the hub: straight to the network

  if (request.mode === 'navigate') {
    event.respondWith(ideaPage(event, request, slug));
  } else if (!request.headers.has('range')) {
    event.respondWith(ideaAsset(event, request, slug));
  }
});

// Idea pages: network-first so a deploy shows up at once; the cached copy
// when offline; the offline page when there is no copy at all.
function ideaPage(event, request, slug) {
  return fetch(request)
    .then(function (response) {
      if (cacheable(response)) event.waitUntil(store(request, response.clone(), slug));
      return withNav(response);
    })
    .catch(function () {
      return caches.open(IDEAS_CACHE).then(function (cache) {
        return cache.match(request, { ignoreSearch: true });
      }).then(function (hit) {
        if (hit) {
          event.waitUntil(touch(slug));
          return withNav(hit);
        }
        return caches.match(at('offline.html'), { cacheName: SHELL_CACHE }).then(function (page) {
          return page ? withNav(page, true) : new Response('Offline', { status: 503 });
        });
      });
    });
}

// Everything else an idea loads: stale-while-revalidate.
function ideaAsset(event, request, slug) {
  return caches.open(IDEAS_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var network = fetch(request).then(function (response) {
        if (cacheable(response)) event.waitUntil(store(request, response.clone(), slug));
        return response;
      });
      if (hit) {
        event.waitUntil(network.catch(function () {}));
        event.waitUntil(touch(slug));
        return hit;
      }
      return network;
    });
  });
}

function cacheable(response) {
  return response && response.status === 200 && response.type === 'basic' && !response.redirected;
}

/* ------------------------------------------------------ navbar injection */

// Adds <script src="…/nav.js" defer> to an HTML page (and, for the offline
// page served at an idea's URL, a <base> so its links resolve to the hub).
// Redirects, opaque and non-HTML responses pass through untouched.
function withNav(response, offline) {
  var type = response.headers.get('content-type') || '';
  // (A cached copy we stored ourselves reads back as type 'default', not
  // 'basic': only opaque responses are off limits.)
  if (/^opaque/.test(response.type) || response.type === 'error' || response.redirected || type.indexOf('text/html') === -1) {
    return response;
  }
  return response.text().then(function (html) {
    var tag = '<script src="' + at('nav.js') + '" defer></script>';
    var i = html.search(/<\/body>/i);
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
    if (offline) html = html.replace(/<head[^>]*>/i, function (m) { return m + '<base href="' + SCOPE + '">'; });
    var headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html, { status: offline ? 503 : response.status, statusText: response.statusText, headers: headers });
  });
}

/* ------------------------------------------------- runtime cache + LRU */

// The ideas cache keeps a small index of its own: bytes per URL, and the
// last time each idea was used. It lives inside the cache as a synthetic
// entry, and every write to it goes through one queue so concurrent
// fetches can't lose each other's updates.
var queue = Promise.resolve();
function serial(task) {
  var run = queue.then(task, task);
  queue = run.catch(function () {});
  return run;
}

function loadIndex(cache) {
  return cache.match(at(INDEX_KEY)).then(function (r) { return r ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (index) {
      index = index || { entries: {}, used: {} };
      index.pinned = index.pinned || {};
      return index;
    });
}
function saveIndex(cache, index) {
  return cache.put(at(INDEX_KEY), new Response(JSON.stringify(index), {
    headers: { 'content-type': 'application/json' }
  }));
}

function store(request, response, slug) {
  return response.blob().then(function (blob) {
    if (blob.size > MAX_ENTRY_BYTES) return;
    return serial(function () {
      return caches.open(IDEAS_CACHE).then(function (cache) {
        var copy = new Response(blob, { status: response.status, statusText: response.statusText, headers: response.headers });
        return cache.put(request, copy).then(function () { return loadIndex(cache); }).then(function (index) {
          index.entries[request.url] = { slug: slug, bytes: blob.size };
          index.used[slug] = Date.now();
          return evict(cache, index, slug).then(function () { return saveIndex(cache, index); });
        });
      });
    });
  }).catch(function () { /* quota or a torn response: skip caching it */ });
}

function touch(slug) {
  return serial(function () {
    return caches.open(IDEAS_CACHE).then(function (cache) {
      return loadIndex(cache).then(function (index) {
        index.used[slug] = Date.now();
        return saveIndex(cache, index);
      });
    });
  });
}

// Drop whole ideas, least recently used first, until under the cap. The idea
// being stored right now, and ideas saved for offline, are never evicted.
function evict(cache, index, keep) {
  var total = 0;
  var bySlug = {};
  Object.keys(index.entries).forEach(function (u) {
    var e = index.entries[u];
    total += e.bytes;
    (bySlug[e.slug] = bySlug[e.slug] || []).push(u);
  });
  if (total <= CAP_BYTES) return Promise.resolve();

  var order = Object.keys(bySlug)
    .filter(function (s) { return s !== keep && !index.pinned[s]; })
    .sort(function (a, b) { return (index.used[a] || 0) - (index.used[b] || 0); });
  var doomed = [];
  for (var i = 0; i < order.length && total > CAP_BYTES; i++) {
    bySlug[order[i]].forEach(function (u) {
      total -= index.entries[u].bytes;
      delete index.entries[u];
      doomed.push(u);
    });
    delete index.used[order[i]];
  }
  return Promise.all(doomed.map(function (u) { return cache.delete(u); }));
}

// After an update (or a worker killed mid-write), make the index and the
// cache agree: forget entries that are gone, delete entries it never knew.
function reconcileIndex() {
  return serial(function () {
    return caches.has(IDEAS_CACHE).then(function (exists) {
      if (!exists) return;
      return caches.open(IDEAS_CACHE).then(function (cache) {
        return Promise.all([cache.keys(), loadIndex(cache)]).then(function (both) {
          var keys = both[0].map(function (r) { return r.url; });
          var index = both[1];
          var present = {};
          keys.forEach(function (u) { present[u] = true; });
          Object.keys(index.entries).forEach(function (u) { if (!present[u]) delete index.entries[u]; });
          var strays = keys.filter(function (u) { return u !== at(INDEX_KEY) && !index.entries[u]; });
          return Promise.all(strays.map(function (u) { return cache.delete(u); }))
            .then(function () { return saveIndex(cache, index); });
        });
      });
    });
  });
}
