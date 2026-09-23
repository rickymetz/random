/* random — homepage-only PWA bits: the Install button (Chromium), the
 * "Add to Home Screen" hint (iOS Safari), the opt-in for the app-icon
 * badge (iOS), the Flat | 3D icon switch, the cards' "Save offline"
 * buttons, and opening links shared to the installed app. Everything shared with idea pages lives in nav.js.
 */
(function () {
  'use strict';

  /* Shared to the app (manifest share_target): a link to one of the ideas
   * opens that idea; anything else just lands on the hub. */
  (function openShared() {
    var params = new URLSearchParams(location.search);
    var hub = new URL('./', location.href);
    var candidates = [params.get('url'), params.get('text'), params.get('title')].join(' ').match(/https?:\/\/\S+/g) || [];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var u = new URL(candidates[i]);
        if (u.origin === hub.origin && u.pathname.indexOf(hub.pathname) === 0 && u.pathname !== hub.pathname) {
          location.replace(u.href);
          return;
        }
      } catch (e) { /* not a URL */ }
    }
    if (params.has('url') || params.has('text')) history.replaceState(null, '', hub.pathname);
  })();

  /* The modern hub's way into the retro launcher (and the launcher's own
   * Settings / menus lead back out). */
  var lookRetro = document.getElementById('look-retro');
  if (lookRetro && window.randomNav) {
    lookRetro.addEventListener('click', function () { window.randomNav.setLook('retro'); });
  }

  /* Icon style: Flat | 3D. The CSS reads <html data-icons>, so this only
   * keeps aria-pressed in step (and nav.js tells every surface). */
  var seg = document.querySelectorAll('.seg [data-icons]');
  function paintSeg() {
    var style = window.randomNav ? window.randomNav.icons() : document.documentElement.getAttribute('data-icons');
    Array.prototype.forEach.call(seg, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-icons') === style ? 'true' : 'false');
    });
  }
  Array.prototype.forEach.call(seg, function (b) {
    b.addEventListener('click', function () {
      if (window.randomNav) window.randomNav.setIcons(b.getAttribute('data-icons'));
    });
  });
  window.addEventListener('randomicons', paintSeg);
  paintSeg();

  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var ios = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function $(id) { return document.getElementById(id); }
  function remembered(key) { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } }
  function remember(key) { try { localStorage.setItem(key, '1'); } catch (e) { /* blocked */ } }

  /* Install (Chromium): the browser fires beforeinstallprompt only when the
   * app is installable and not yet installed. */
  var install = $('install');
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (!standalone) install.hidden = false;
  });
  install.addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () {
      deferred = null;
      install.hidden = true;
    });
  });
  window.addEventListener('appinstalled', function () { install.hidden = true; });

  /* Install (iOS Safari): no prompt API, so say where the menu item is. */
  var hint = $('ios-hint');
  var HINT_KEY = 'random-hub:ios-hint-dismissed';
  if (ios && !standalone && !remembered(HINT_KEY)) hint.hidden = false;
  hint.querySelector('button').addEventListener('click', function () {
    hint.hidden = true;
    remember(HINT_KEY);
  });

  /* App-icon badge (iOS): Safari honours setAppBadge only once notification
   * permission is granted. Ask only when the person taps the toggle; nothing
   * here ever sends a notification. */
  var toggle = $('badge-toggle');
  if (ios && standalone && 'setAppBadge' in navigator && 'Notification' in window &&
      Notification.permission === 'default') {
    toggle.hidden = false;
    toggle.addEventListener('click', function () {
      Notification.requestPermission().then(function (result) {
        toggle.hidden = true;
        // nav.js recounts on every page load; reload so the badge appears now.
        if (result === 'granted') location.reload();
      });
    });
  }

  /* Save offline (nav.js does the work: a hidden frame so the worker caches
   * what a visit would, then a pin so eviction leaves it). Tapping a saved
   * idea unpins it. */
  var nav = window.randomNav;
  var buttons = document.querySelectorAll('.save[data-slug]');
  if (!buttons.length || !nav || !('serviceWorker' in navigator)) return;

  function paint(state) {
    Array.prototype.forEach.call(buttons, function (btn) {
      var saved = state.saved.indexOf(btn.dataset.slug) !== -1;
      btn.hidden = false;
      btn.closest('.card-wrap').classList.add('has-save');
      btn.removeAttribute('aria-busy');
      btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      btn.textContent = saved ? 'Saved offline' : 'Save offline';
      btn.title = saved ? 'Saved on this device. Tap to let it be cleared when space runs low.' : '';
    });
  }

  function start() {
    nav.offlineStatus().then(paint).catch(function () { /* worker not ready: no buttons */ });
  }

  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-busy') === 'true') return;
      var slug = btn.dataset.slug;
      var saved = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = saved ? 'Removing…' : 'Saving…';
      nav.saveOffline(slug, !saved)
        .then(paint)
        .catch(function () { btn.removeAttribute('aria-busy'); btn.textContent = 'Try again'; });
    });
  });

  if (navigator.serviceWorker.controller) start();
  else navigator.serviceWorker.addEventListener('controllerchange', start);
})();
