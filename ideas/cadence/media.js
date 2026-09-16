/* Cadence — clips you add yourself.
 *
 * A photo, GIF or video per exercise, kept in IndexedDB on this device. Blobs
 * are far too big for localStorage and far too big to sit in the JSON backup,
 * so they live here alone: the metadata index is small and loads up front, and
 * the blob itself is only fetched when something is about to show it.
 *
 * Nothing is uploaded. There is no server to upload to.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'cadence-media';
  var VERSION = 1;
  var MAX_BYTES = 80 * 1024 * 1024;

  var supported = !!global.indexedDB;
  var dbPromise = null;
  var index = {};          // exId -> { type, name, size, addedAt }
  var urls = {};           // exId -> object URL, once loaded
  var readyPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, run) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var req = run(t.objectStore(store));
        t.oncomplete = function () { resolve(req && req.result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  /* The index only — small, so the UI knows what exists without touching blobs. */
  function ready() {
    if (readyPromise) return readyPromise;
    if (!supported) { readyPromise = Promise.resolve({}); return readyPromise; }
    readyPromise = open().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction('meta', 'readonly');
        var store = t.objectStore('meta');
        var keysReq = store.getAllKeys();
        var valsReq = store.getAll();
        t.oncomplete = function () {
          (keysReq.result || []).forEach(function (key, i) {
            index[key] = valsReq.result[i];
          });
          resolve(index);
        };
        t.onerror = function () { resolve(index); };
      });
    }).catch(function () { return index; });
    return readyPromise;
  }

  function info(exId) {
    return index[exId] || null;
  }

  function url(exId) {
    return urls[exId] || null;
  }

  /* Resolve the blob to an object URL, once. */
  function load(exId) {
    if (!supported || !index[exId]) return Promise.resolve(null);
    if (urls[exId]) return Promise.resolve({ url: urls[exId], meta: index[exId] });
    return tx('blobs', 'readonly', function (store) { return store.get(exId); })
      .then(function (blob) {
        if (!blob) return null;
        urls[exId] = URL.createObjectURL(blob);
        return { url: urls[exId], meta: index[exId] };
      })
      .catch(function () { return null; });
  }

  function save(exId, file) {
    if (!supported) return Promise.reject(new Error('This browser will not store clips.'));
    if (file.size > MAX_BYTES) {
      return Promise.reject(new Error('That clip is over 80 MB — trim it down first.'));
    }
    if (!/^(image|video)\//.test(file.type)) {
      return Promise.reject(new Error('Pick an image or a video.'));
    }
    var meta = { type: file.type, name: file.name || 'clip', size: file.size, addedAt: Date.now() };
    return tx('blobs', 'readwrite', function (store) { return store.put(file, exId); })
      .then(function () { return tx('meta', 'readwrite', function (store) { return store.put(meta, exId); }); })
      .then(function () {
        revoke(exId);
        index[exId] = meta;
        return meta;
      });
  }

  function revoke(exId) {
    if (urls[exId]) {
      try { URL.revokeObjectURL(urls[exId]); } catch (e) {}
      delete urls[exId];
    }
  }

  function remove(exId) {
    if (!supported) return Promise.resolve();
    return tx('blobs', 'readwrite', function (store) { return store.delete(exId); })
      .then(function () { return tx('meta', 'readwrite', function (store) { return store.delete(exId); }); })
      .then(function () {
        revoke(exId);
        delete index[exId];
      });
  }

  function clear() {
    if (!supported) return Promise.resolve();
    Object.keys(urls).forEach(revoke);
    return tx('blobs', 'readwrite', function (store) { return store.clear(); })
      .then(function () { return tx('meta', 'readwrite', function (store) { return store.clear(); }); })
      .then(function () { index = {}; });
  }

  function count() {
    return Object.keys(index).length;
  }

  function totalBytes() {
    return Object.keys(index).reduce(function (sum, key) { return sum + (index[key].size || 0); }, 0);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  global.CadenceMedia = {
    supported: supported,
    ready: ready,
    info: info,
    url: url,
    load: load,
    save: save,
    remove: remove,
    clear: clear,
    count: count,
    totalBytes: totalBytes,
    formatBytes: formatBytes
  };
})(window);
