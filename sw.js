/* random has moved to https://rickymetz.com/. This retires the hub's old
 * service worker: an installed copy picks this up on its next update check,
 * deletes the hub's caches (random-hub-*), unregisters itself and reloads
 * the pages it controlled, so they come from the network (and redirect)
 * instead of the cached hub. Ledger's and Cadence's own workers are
 * untouched. */
self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k.indexOf('random-hub-') === 0; })
      .map(function (k) { return caches.delete(k); }));
    await self.registration.unregister();
    var clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
  })());
});
