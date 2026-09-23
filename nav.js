/* random — the hub's bottom navbar.
 *
 * One classic script, loaded on every page of the hub:
 *   - the homepage and offline page include it directly;
 *   - idea pages get it injected by the hub service worker (sw.js);
 *   - ideas that ship their own service worker (Cadence, Ledger) are out of
 *     the hub worker's reach, so they carry a <script> tag for it themselves.
 *
 * It draws an Android-style ◀ ● ■ bar (Back, Home, Recents) in a shadow
 * root (so idea CSS can't reach it, nor its CSS the idea), keeps the
 * recents / "new idea" bookkeeping in localStorage, sets the app-icon
 * badge, and offers hub updates as a toast.
 *
 * Ideas talk to it through a small, documented surface (README):
 *   --random-nav-h                    set on <html>; offset bottom UI by it
 *   <meta name="random-nav" content="off">      no bar on this page
 *   <meta name="random-nav" content="overlay">  bar, but no bottom spacer
 *   <a data-random-keep>              keep this "← random" link visible
 *   window.randomNav.look() / .setLook('retro'|'modern'): the hub's two
 *                                     looks (a 'randomlook' event fires on
 *                                     window when it changes)
 *   window.randomNav.hide() / .show() tuck the bar away for an immersive
 *                                     moment (a handle or an edge swipe
 *                                     brings it back); full screen hides
 *                                     it automatically
 *
 * Storage is best-effort: every read and write is wrapped, and the bar
 * works (without recents) when storage is unavailable.
 */
(function () {
  'use strict';

  if (window.__randomNav) return; // injected *and* script-tagged: draw once
  window.__randomNav = true;
  // Framed, this is the hub saving an idea for offline in a hidden iframe
  // (hub.js): no bar, and the visit must not count as the idea being opened.
  if (window.top !== window.self) return;

  var script = document.currentScript;
  var HUB = new URL('./', script ? script.src : location.href);
  var HUB_PATH = HUB.pathname;

  var KEY = {
    recents: 'random-hub:recents',
    opened: 'random-hub:opened',
    since: 'random-hub:since',
    trail: 'random-hub:trail',
    look: 'random-hub:look'
  };
  var MAX_RECENTS = 8;
  var BAR_H = 48;

  var page = document.documentElement.getAttribute('data-random-page') || 'idea';
  var isHub = page === 'hub';
  var isOffline = page === 'offline';

  var metaNav = document.querySelector('meta[name="random-nav"]');
  var navMode = metaNav ? (metaNav.getAttribute('content') || '').trim() : '';

  /* ------------------------------------------------------------ storage */

  function read(store, key, fallback) {
    try {
      var raw = store.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch (e) { /* full or blocked */ }
  }
  var local = (function () { try { return window.localStorage; } catch (e) { return null; } })();
  var session = (function () { try { return window.sessionStorage; } catch (e) { return null; } })();
  function lget(k, f) { return local ? read(local, k, f) : f; }
  function lset(k, v) { if (local) write(local, k, v); }
  function sget(k, f) { return session ? read(session, k, f) : f; }
  function sset(k, v) { if (session) write(session, k, v); }

  /* -------------------------------------------------------------- look */

  // Two looks: 'modern' (the card grid) and 'retro' (the Gingerbread
  // launcher, retro.js). A saved choice wins; otherwise retro when running
  // as the installed app, modern in a browser tab. The hub's inline head
  // script makes the same decision before first paint.
  function standalone() {
    try {
      return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    } catch (e) { return false; }
  }
  function currentLook() {
    var saved = lget(KEY.look, null);
    if (saved === 'retro' || saved === 'modern') return saved;
    return standalone() ? 'retro' : 'modern';
  }
  var look = currentLook();
  document.documentElement.setAttribute('data-look', look);

  function setLook(next) {
    if (next !== 'retro' && next !== 'modern') return;
    lset(KEY.look, next);
    if (next === look) return;
    look = next;
    document.documentElement.setAttribute('data-look', look);
    applyLook();
    try { window.dispatchEvent(new CustomEvent('randomlook', { detail: { look: look } })); } catch (e) {}
  }

  /* ---------------------------------------------------- where are we? */

  // "ideas/<slug>/…" is an idea; so is a top-level app deployed beside the
  // hub (ledger/) when ideas.json lists a slug of that name.
  function slugFromPath(pathname) {
    if (pathname.indexOf(HUB_PATH) !== 0) return null;
    var segs = pathname.slice(HUB_PATH.length).split('/').filter(Boolean);
    if (!segs.length) return null;
    if (segs[0] === 'ideas') return segs[1] || null;
    return segs[0];
  }
  var slug = isHub || isOffline ? null : slugFromPath(location.pathname);

  // First run anywhere sets the baseline: ideas older than this are never
  // "new", so a first visit doesn't light up every card.
  if (!lget(KEY.since, null)) lset(KEY.since, new Date().toISOString());

  // A per-tab breadcrumb of pages seen, so Back knows whether there is
  // somewhere in the app to go back to. Returning to the previous entry
  // pops rather than pushes.
  var trail = sget(KEY.trail, { base: history.length, paths: [] });
  var here = location.pathname + location.search;
  if (trail.paths.length > 1 && trail.paths[trail.paths.length - 2] === here) {
    trail.paths.pop();
    // history.length never shrinks, so after coming back it would still
    // claim there is somewhere to go back to. Re-anchor it.
    trail.base = history.length;
  } else if (trail.paths[trail.paths.length - 1] !== here) {
    trail.paths.push(here);
    if (trail.paths.length > 50) trail.paths = trail.paths.slice(-50);
  }
  sset(KEY.trail, trail);

  // Back stays inside the app: pages this tab has seen here, or entries an
  // idea pushed itself (an SPA's own history). Where the Navigation API
  // exists it also vetoes a Back that would go nowhere.
  function canGoBack() {
    if (window.navigation && 'canGoBack' in window.navigation && !window.navigation.canGoBack) return false;
    return trail.paths.length > 1 || history.length > trail.base;
  }

  /* ------------------------------------------------------ idea catalogue */

  var ideas = null; // [{slug,title,emoji,date,url}] from the hub's ideas.json
  var ideasReady = fetch(new URL('ideas.json', HUB).href, { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; })
    .then(function (list) { ideas = Array.isArray(list) ? list : []; return ideas; });

  function ideaBySlug(s) {
    if (!ideas) return null;
    for (var i = 0; i < ideas.length; i++) if (ideas[i].slug === s) return ideas[i];
    return null;
  }

  /* --------------------------------------------- recents, opened, badge */

  function recordVisit() {
    if (!slug) return;
    var known = ideaBySlug(slug);
    // Outside ideas/ only listed slugs count (so /random/docs/ is not an idea).
    if (!known && location.pathname.indexOf(HUB_PATH + 'ideas/') !== 0) return;

    var recents = lget(KEY.recents, []).filter(function (r) { return r && r.slug !== slug; });
    recents.unshift({
      slug: slug,
      title: known ? known.title : document.title || slug,
      visitedAt: new Date().toISOString()
    });
    lset(KEY.recents, recents.slice(0, MAX_RECENTS));

    var opened = lget(KEY.opened, []);
    if (opened.indexOf(slug) === -1) { opened.push(slug); lset(KEY.opened, opened); }
  }

  function isNew(idea) {
    var since = lget(KEY.since, null);
    if (!since || !idea.date) return false;
    if (lget(KEY.opened, []).indexOf(idea.slug) !== -1) return false;
    return new Date(idea.date) > new Date(since);
  }

  function updateBadge() {
    if (!ideas || !('setAppBadge' in navigator)) return;
    var count = ideas.filter(isNew).length;
    // iOS rejects without notification permission (see hub.js): harmless.
    var p = count ? navigator.setAppBadge(count) : navigator.clearAppBadge();
    if (p && p.catch) p.catch(function () {});
  }

  function markNewCards() {
    if (!isHub || !ideas) return;
    ideas.forEach(function (idea) {
      if (!isNew(idea)) return;
      var card = document.querySelector('.card[data-slug="' + CSS.escape(idea.slug) + '"]');
      if (!card || card.querySelector('.card-new')) return;
      var pill = document.createElement('span');
      pill.className = 'card-new';
      pill.textContent = 'New';
      var top = card.querySelector('.card-top') || card;
      top.insertBefore(pill, top.querySelector('time'));
    });
  }

  ideasReady.then(function () {
    recordVisit();
    markNewCards();
    updateBadge();
  });

  /* -------------------------------------------------------------- UI */

  var ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 5.5v13L6.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    recents: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  var CSS_TEXT = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; }',
    '.wrap {',
    '  --ink: #1a1a1a; --muted: #6b6b6b; --line: rgba(0,0,0,.09);',
    '  --bar: rgba(250,249,247,.84); --sheet: #faf9f7; --card: #fff; --accent: #b3542e;',
    '  font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;',
    '  color: var(--ink);',
    '}',
    // Dark ink etc. when the page underneath is dark (see matchPage), not
    // merely when the system is: plenty of ideas are dark in a light OS.
    '.wrap.dark {',
    '  --ink: #eceae6; --muted: #9a9a9a; --line: rgba(255,255,255,.1);',
    '  --bar: rgba(20,20,20,.84); --sheet: #1a1a1a; --card: #242424; --accent: #e08554;',
    '}',
    '.bar {',
    '  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483000;',
    '  transition: transform .25s cubic-bezier(.32,.72,0,1);',
    '  display: flex; justify-content: space-around; align-items: center;',
    '  height: calc(' + BAR_H + 'px + env(safe-area-inset-bottom, 0px));',
    '  padding: 0 max(8px, env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) max(8px, env(safe-area-inset-left, 0px));',
    '  background: var(--bar); border-top: 1px solid var(--line);',
    '  -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4);',
    '}',
    '.bar button {',
    '  width: 64px; height: 48px; display: grid; place-items: center;',
    '  border: 0; border-radius: 24px; background: none; color: var(--ink);',
    '  cursor: pointer; -webkit-tap-highlight-color: transparent; padding: 0;',
    '}',
    '.bar button svg { width: 24px; height: 24px; }',
    '@media (hover: hover) { .bar button:hover { background: var(--line); } }',
    '.bar button:active { background: var(--line); transform: scale(.94); }',
    '.bar button:focus-visible, .sheet button:focus-visible, .toast button:focus-visible, .card:focus-visible {',
    '  outline: 2px solid var(--accent); outline-offset: 2px;',
    '}',
    '.bar button[disabled] { opacity: .3; cursor: default; background: none; transform: none; }',
    '.bar button[hidden] { visibility: hidden; display: grid; }',
    '.scrim { position: fixed; inset: 0; z-index: 2147482998; background: rgba(0,0,0,.35);',
    '  opacity: 0; pointer-events: none; transition: opacity .18s; }',
    '.sheet {',
    '  position: fixed; left: 0; right: 0; z-index: 2147482999;',
    '  bottom: calc(' + BAR_H + 'px + env(safe-area-inset-bottom, 0px));',
    '  background: var(--sheet); border-top: 1px solid var(--line);',
    '  border-radius: 16px 16px 0 0; padding: 14px 0 16px;',
    '  transform: translateY(calc(100% + ' + BAR_H + 'px)); transition: transform .24s cubic-bezier(.32,.72,0,1);',
    '  box-shadow: 0 -8px 30px rgba(0,0,0,.12);',
    '}',
    '.open .scrim { opacity: 1; pointer-events: auto; }',
    '.open .sheet { transform: none; }',
    '.head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 16px 10px; }',
    '.head h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }',
    '.head button { border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; padding: 6px; }',
    '.head .share { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; }',
    '.head .share svg { width: 16px; height: 16px; }',
    '.strip { display: flex; gap: 10px; overflow-x: auto; padding: 2px 16px 4px; scroll-snap-type: x mandatory;',
    '  scrollbar-width: none; overscroll-behavior-x: contain; }',
    '.strip::-webkit-scrollbar { display: none; }',
    '.item { position: relative; flex: 0 0 auto; scroll-snap-align: start; }',
    '.card { display: flex; flex-direction: column; gap: 6px; width: 132px; min-height: 112px; padding: 12px;',
    '  border: 1px solid var(--line); border-radius: 12px; background: var(--card);',
    '  color: inherit; text-decoration: none; }',
    '.card .emoji { font-size: 22px; line-height: 1; }',
    '.card .title { font-weight: 600; font-size: 13px; overflow: hidden; display: -webkit-box;',
    '  -webkit-line-clamp: 2; -webkit-box-orient: vertical; }',
    '.card .when { color: var(--muted); font-size: 12px; margin-top: auto; }',
    '.item .x { position: absolute; top: 2px; right: 2px; width: 32px; height: 32px; display: grid; place-items: center;',
    '  border: 0; border-radius: 16px; background: none; color: var(--muted); cursor: pointer; padding: 0; }',
    '.item .x svg { width: 14px; height: 14px; }',
    '.empty { color: var(--muted); padding: 8px 16px 12px; margin: 0; }',
    '.toast { position: fixed; left: 50%; z-index: 2147483001; transform: translateX(-50%);',
    '  bottom: calc(' + (BAR_H + 12) + 'px + env(safe-area-inset-bottom, 0px));',
    '  display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 24px);',
    '  padding: 8px 8px 8px 16px; border-radius: 999px; background: var(--ink); color: var(--sheet);',
    '  box-shadow: 0 6px 24px rgba(0,0,0,.22); }',
    '.toast span { white-space: nowrap; }',
    '.toast[hidden] { display: none; }',
    '.toast button { border: 0; border-radius: 999px; padding: 6px 12px; background: var(--accent); color: #fff;',
    '  font: inherit; font-weight: 600; cursor: pointer; }',
    '.nobar .bar { display: none; }',
    '.nobar .toast, .tucked .toast { bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }',
    '.tucked .bar { transform: translateY(100%); pointer-events: none; }',
    '.handle { position: fixed; left: 50%; bottom: 0; z-index: 2147483000; transform: translateX(-50%);',
    '  display: none; width: 96px; height: calc(28px + env(safe-area-inset-bottom, 0px)); padding: 0 0 env(safe-area-inset-bottom, 0px);',
    '  border: 0; background: none; cursor: pointer; place-items: center; -webkit-tap-highlight-color: transparent; }',
    '.handle::before { content: ""; width: 44px; height: 5px; border-radius: 3px; background: var(--ink); opacity: .35; }',
    '.tucked .handle { display: grid; }',
    '.handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; border-radius: 8px; }',
    '@media (prefers-reduced-motion: reduce) { .sheet, .scrim, .bar { transition: none; } }'
  ].join('\n');

  var host, ui = {};

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (html != null) node.innerHTML = html;
    return node;
  }

  function mount() {
    host = document.createElement('random-nav');
    host.style.cssText = 'all: initial; position: static;';
    var root = host.attachShadow({ mode: 'open' }); // open: tests reach in
    var style = document.createElement('style');
    style.textContent = CSS_TEXT;
    root.appendChild(style);

    var wrap = el('div', { 'class': 'wrap' });
    if (navMode === 'off') wrap.classList.add('nobar');

    ui.scrim = el('div', { 'class': 'scrim' });
    ui.sheet = el('div', { 'class': 'sheet', role: 'dialog', 'aria-label': 'Recent ideas', 'aria-hidden': 'true' });
    ui.sheet.appendChild(el('div', { 'class': 'head' },
      '<h2>Recent</h2>' +
      (slug ? '<button type="button" class="share" data-act="share">' + ICON.share + 'Share</button>' : '') +
      '<button type="button" data-act="clear">Clear all</button>'));
    ui.strip = el('div', { 'class': 'strip' });
    ui.sheet.appendChild(ui.strip);

    ui.bar = el('nav', { 'class': 'bar', 'aria-label': 'random' });
    ui.back = el('button', { type: 'button', 'aria-label': 'Back', title: 'Back' }, ICON.back);
    ui.home = el('button', { type: 'button', 'aria-label': 'Home (all ideas)', title: 'Home' }, ICON.home);
    ui.recents = el('button', { type: 'button', 'aria-label': 'Recent ideas', title: 'Recent',
      'aria-expanded': 'false' }, ICON.recents);
    ui.bar.appendChild(ui.back);
    ui.bar.appendChild(ui.home);
    ui.bar.appendChild(ui.recents);

    ui.toast = el('div', { 'class': 'toast', role: 'status', hidden: '' }, '<span></span><button type="button"></button>');
    ui.handle = el('button', { type: 'button', 'class': 'handle', 'aria-label': 'Show navigation' });

    wrap.appendChild(ui.scrim);
    wrap.appendChild(ui.sheet);
    wrap.appendChild(ui.toast);
    wrap.appendChild(ui.bar);
    wrap.appendChild(ui.handle);
    root.appendChild(wrap);
    ui.wrap = wrap;
    matchPage();
    watchPage();

    applyLook();
    if (isHub && !canGoBack()) ui.back.hidden = true;

    ui.back.addEventListener('click', function () {
      if (canGoBack()) history.back();
      else location.href = HUB.href;
    });
    ui.home.addEventListener('click', function () {
      if (longPressed) { longPressed = false; return; }
      // On the retro launcher, Home is a launcher action: close whatever is
      // open and go back to the centre home screen (retro.js listens).
      if (isHub) { window.dispatchEvent(new CustomEvent('randomhome')); return; }
      location.href = HUB.href;
    });
    onLongPress(ui.home, share);
    var shareBtn = ui.sheet.querySelector('[data-act="share"]');
    if (shareBtn) shareBtn.addEventListener('click', function () { toggleTray(false); share(); });
    ui.handle.addEventListener('click', function () { show(); });
    ui.recents.addEventListener('click', function () { toggleTray(); });
    ui.scrim.addEventListener('click', function () { toggleTray(false); });
    ui.sheet.querySelector('[data-act="clear"]').addEventListener('click', function () {
      lset(KEY.recents, []);
      renderTray();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap.classList.contains('open')) toggleTray(false);
    });

    // The bar is its own UI: a tap on it must not also reach the page (on
    // Breathe, a tap anywhere starts the exercise).
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'].forEach(function (type) {
      host.addEventListener(type, function (e) { e.stopPropagation(); });
    });

    document.body.appendChild(host);

    if (navMode !== 'off') {
      var h = 'calc(' + BAR_H + 'px + env(safe-area-inset-bottom, 0px))';
      document.documentElement.style.setProperty('--random-nav-h', h);
      document.documentElement.classList.add('random-nav');
      if (navMode !== 'overlay') {
        // A spacer rather than body padding, so an idea's own padding stays
        // exactly as it wrote it.
        var spacer = document.createElement('div');
        spacer.setAttribute('aria-hidden', 'true');
        spacer.setAttribute('data-random-nav-spacer', '');
        spacer.style.cssText = 'height: var(--random-nav-h); flex: none; pointer-events: none;';
        document.body.appendChild(spacer);
      }
      hideOwnHubLinks();
      watchImmersive();
    }
  }

  /* ------------------------------------------------- immersive moments */

  // An idea tucks the bar away (window.randomNav.hide()) for something
  // immersive — Breathe's exercise — and full screen tucks it too. A small
  // handle stays at the bottom edge: tap it, or swipe up from the edge, and
  // the bar is back. --random-nav-h drops to the bare safe area meanwhile,
  // so ideas' bottom UI settles down with it.
  var tucked = false;
  var tuckedBeforeFullscreen = false;
  function setTucked(on) {
    if (!ui.wrap || navMode === 'off' || tucked === on) return;
    tucked = on;
    ui.wrap.classList.toggle('tucked', on);
    if (on) toggleTray(false);
    document.documentElement.style.setProperty('--random-nav-h', on
      ? 'env(safe-area-inset-bottom, 0px)'
      : 'calc(' + BAR_H + 'px + env(safe-area-inset-bottom, 0px))');
  }
  function hide() { setTucked(true); }
  function show() { setTucked(false); }

  function watchImmersive() {
    function onFullscreen() {
      var fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (fs) { tuckedBeforeFullscreen = tucked; hide(); }
      else if (!tuckedBeforeFullscreen) show();
    }
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);

    // Swipe up from the bottom edge, as on Android.
    var startY = null;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      startY = tucked && t && t.clientY > window.innerHeight - 32 ? t.clientY : null;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (startY != null && t && startY - t.clientY > 36) { startY = null; show(); }
    }, { passive: true });
  }

  /* ------------------------------------------------------------ share */

  // Long-press ● (or "Share" in the tray): the system share sheet with this
  // idea's link, or the clipboard where there is no share sheet.
  var longPressed = false;
  function onLongPress(node, fn) {
    var timer = null;
    function cancel() { clearTimeout(timer); timer = null; }
    node.addEventListener('pointerdown', function () {
      longPressed = false;
      cancel();
      timer = setTimeout(function () { longPressed = true; timer = null; fn(); }, 500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { node.addEventListener(t, cancel); });
    node.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function share() {
    var known = slug && ideaBySlug(slug);
    var url = known && known.url ? new URL(known.url, HUB).href : (isHub ? HUB.href : location.href);
    var title = known ? known.title : document.title;
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () { /* dismissed */ });
      return;
    }
    var copied = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(url) : Promise.reject();
    copied.then(function () { toast('Link copied', null, 2200); },
      function () { toast(url, null, 5000); });
  }

  /* ------------------------------------------------------------ toast */

  var toastTimer = null;
  function toast(text, action, ms) {
    clearTimeout(toastTimer);
    ui.toast.querySelector('span').textContent = text;
    var btn = ui.toast.querySelector('button');
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = function () { ui.toast.hidden = true; action.run(); };
    }
    ui.toast.hidden = false;
    if (ms) toastTimer = setTimeout(function () { ui.toast.hidden = true; }, ms);
  }

  // What the bar looks like for the current look. On the modern hub Home
  // has nowhere to go; on the retro launcher it's the launcher's Home key.
  function applyLook() {
    if (!ui.home) return;
    var inert = isHub && look !== 'retro';
    ui.home.disabled = inert;
    ui.home.setAttribute('aria-label', inert ? 'Home (you are here)' : 'Home (all ideas)');
  }

  window.randomNav = {
    hide: hide,
    show: show,
    share: share,
    look: function () { return look; },
    setLook: setLook,
    // For the launcher: the idea catalogue, and what this device knows.
    ideas: function () { return ideasReady; },
    isNew: function (idea) { return isNew(idea); },
    recents: function () { return lget(KEY.recents, []); },
    toast: function (text, ms) { if (ui.toast) toast(text, null, ms || 2200); },
    // The launcher pushes history entries (the drawer); Back's visibility
    // on the hub follows whether there is anywhere to go back to.
    refreshBack: refreshBack
  };

  function refreshBack() {
    if (ui.back && isHub) ui.back.hidden = !canGoBack();
  }
  window.addEventListener('popstate', function () { setTimeout(refreshBack, 0); });

  // Ideas that predate the bar carry their own link home: "← random", or an
  // icon-only arrow with just an aria-label. While the bar is up it is
  // redundant; if the bar ever fails to load, the link is still there.
  // Links home that read as prose ("Part of random") stay.
  function hideOwnHubLinks() {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.hasAttribute('data-random-keep') || host.contains(a)) continue;
      var url;
      try { url = new URL(a.href); } catch (e) { continue; }
      var toHub = url.origin === HUB.origin &&
        (url.pathname === HUB_PATH || url.pathname === HUB_PATH + 'index.html');
      var text = (a.textContent || '').trim();
      if (toHub && (text === '' || text.charAt(0) === '←')) a.style.setProperty('display', 'none', 'important');
    }
  }

  /* ------------------------------------------------------ page colours */

  // The bar takes its colours from the page it sits on: the page's own
  // background (body, else html, else the system scheme) tints the bar and
  // the tray, and its lightness picks light or dark ink.
  function parseColor(c) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/.exec(c || '');
    if (!m) return null;
    var a = m[4] == null ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }

  function pageBackground() {
    var els = [document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      var c = els[i] && parseColor(getComputedStyle(els[i]).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return null;
  }

  function mix(c, toward, amount) {
    return {
      r: Math.round(c.r + (toward - c.r) * amount),
      g: Math.round(c.g + (toward - c.g) * amount),
      b: Math.round(c.b + (toward - c.b) * amount)
    };
  }
  function rgb(c, a) { return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (a == null ? 1 : a) + ')'; }

  function matchPage() {
    if (!ui.wrap) return;
    var bg = pageBackground();
    var dark = bg
      ? (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255 < 0.5
      : matchMedia('(prefers-color-scheme: dark)').matches;
    ui.wrap.classList.toggle('dark', dark);
    var style = ui.wrap.style;
    if (!bg) {
      ['--bar', '--sheet', '--card'].forEach(function (p) { style.removeProperty(p); });
      return;
    }
    style.setProperty('--bar', rgb(bg, 0.86));
    style.setProperty('--sheet', rgb(dark ? mix(bg, 255, 0.04) : bg));
    style.setProperty('--card', rgb(dark ? mix(bg, 255, 0.09) : mix(bg, 255, 0.7)));
  }

  // Pages change colour under us: a theme toggle (Cadence's ◐), a class on
  // body, the system switching to dark mode at dusk.
  function watchPage() {
    var pending = false;
    function soon() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; matchPage(); });
    }
    var opts = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
    var mo = new MutationObserver(soon);
    mo.observe(document.documentElement, opts);
    mo.observe(document.body, opts);
    var mq = matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', soon);
    window.addEventListener('load', soon);
  }

  /* ------------------------------------------------------------- tray */

  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!(s >= 0)) return '';
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60); if (h < 24) return h + ' h ago';
    var d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(iso).toLocaleDateString();
  }

  function renderTray() {
    var list = lget(KEY.recents, []).filter(function (r) { return r && r.slug && r.slug !== slug; });
    ui.strip.textContent = '';
    ui.sheet.querySelector('[data-act="clear"]').hidden = !list.length;
    if (!list.length) {
      ui.strip.appendChild(el('p', { 'class': 'empty' }, null)).textContent =
        'Ideas you open will show up here.';
      return;
    }
    list.forEach(function (r) {
      var known = ideaBySlug(r.slug);
      var href = new URL(known && known.url ? known.url : 'ideas/' + r.slug + '/', HUB).href;
      var item = el('div', { 'class': 'item' });
      var card = el('a', { 'class': 'card', href: href });
      var emoji = el('span', { 'class': 'emoji', 'aria-hidden': 'true' });
      emoji.textContent = (known && known.emoji) || '✦';
      var title = el('span', { 'class': 'title' });
      title.textContent = (known && known.title) || r.title || r.slug;
      var when = el('span', { 'class': 'when' });
      when.textContent = ago(r.visitedAt);
      card.appendChild(emoji); card.appendChild(title); card.appendChild(when);
      var x = el('button', { type: 'button', 'class': 'x', 'aria-label': 'Remove ' + title.textContent + ' from recents' }, ICON.close);
      x.addEventListener('click', function () {
        lset(KEY.recents, lget(KEY.recents, []).filter(function (e) { return e && e.slug !== r.slug; }));
        renderTray();
        var first = ui.strip.querySelector('.card') || ui.recents;
        first.focus();
      });
      item.appendChild(card); item.appendChild(x);
      ui.strip.appendChild(item);
    });
  }

  function toggleTray(force) {
    var open = force != null ? force : !ui.wrap.classList.contains('open');
    if (open) renderTray();
    ui.wrap.classList.toggle('open', open);
    ui.sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    ui.recents.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var first = ui.strip.querySelector('.card');
      if (first) first.focus({ preventScroll: true });
    } else if (ui.wrap.contains(document.activeElement) || host.matches(':focus-within')) {
      ui.recents.focus();
    }
  }

  /* ----------------------------------------------------------- updates */

  // Every page registers the hub worker (idempotent), so a visitor who
  // lands on an idea first still gets the hub installed and cached.
  // Registering from inside Cadence or Ledger is harmless: their own,
  // more specific registrations keep control of their pages.
  function watchUpdates() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    var refreshing = false;
    navigator.serviceWorker.register(new URL('sw.js', HUB).href, { scope: HUB.href }).then(function (reg) {
      function offer(worker) {
        toast('New ideas available', { label: 'Refresh', run: function () {
          worker.addEventListener('statechange', function () {
            if (worker.state === 'activated' && !refreshing) { refreshing = true; location.reload(); }
          });
          worker.postMessage({ type: 'SKIP_WAITING' });
        } });
      }
      // Only an *update* is news: the very first install has no older
      // version to replace.
      var hadWorker = !!(reg.active);
      if (reg.waiting && hadWorker) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && hadWorker) offer(worker);
          if (worker.state === 'activated') hadWorker = true;
        });
      });
    }).catch(function () { /* unsupported or blocked: the bar still works */ });
  }

  function start() {
    mount();
    watchUpdates();
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
