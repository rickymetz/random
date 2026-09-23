/* random — homepage-only PWA bits: the Install button (Chromium), the
 * "Add to Home Screen" hint (iOS Safari) and the opt-in for the app-icon
 * badge (iOS). Everything shared with idea pages lives in nav.js.
 */
(function () {
  'use strict';

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
})();
