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
    look: 'random-hub:look',
    events: 'random-hub:events',
    dismissed: 'random-hub:shade-dismissed'
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
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    wallpaper: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.6" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M14.5 14.5L20 20" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    look: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="18" r="1.2" fill="currentColor"/></svg>',
    about: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.8" r="1.2" fill="currentColor"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    saved: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hub: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
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
    '.bar .menu { display: none; }',

    /* ---- retro (Gingerbread) skin: black hardware keys, glowing glyphs,
       lime press; era dialogs, toast and options panel ---- */
    '.retro { font-family: "Droid Sans", ui-sans-serif, system-ui, sans-serif; --accent: #9fd01d; }',
    '.retro .bar { background: linear-gradient(180deg, #232323, #000 55%); border-top: 1px solid #3a3a3a;',
    '  -webkit-backdrop-filter: none; backdrop-filter: none; }',
    '.retro .bar .menu { display: grid; }',
    '.retro .bar button { color: #f2f2f2; border-radius: 4px; filter: drop-shadow(0 0 3px rgba(255,255,255,.55)); }',
    '@media (hover: hover) { .retro .bar button:hover { background: rgba(255,255,255,.07); } }',
    '.retro .bar button:active { background: rgba(159,208,29,.3); color: #cff27a; transform: none; }',
    '.retro .bar button[disabled] { filter: none; }',
    '.retro .handle::before { background: #9a9a9a; }',
    '.retro .toast { border-radius: 6px; background: linear-gradient(180deg, #474747, #2b2b2b); color: #fff;',
    '  border: 1px solid #5a5a5a; padding: 9px 10px 9px 14px; box-shadow: 0 4px 16px rgba(0,0,0,.5); }',
    '.retro .toast button { border-radius: 4px; background: linear-gradient(180deg, #b6e236, #86b312); color: #000; }',
    '.retro .sheet { background: linear-gradient(180deg, #2b2b2b, #161616); color: #fff; border-radius: 0;',
    '  border-top: 1px solid #555; }',
    '.retro .head h2 { color: #fff; }',
    '.retro .head button { color: #9fd01d; }',
    '.retro .card { background: #1f1f1f; border-color: #3a3a3a; border-radius: 4px; color: #fff; }',
    '.retro .card:active { background: #9fd01d; color: #000; }',
    '.retro .card .when { color: #a0a0a0; }',

    // The scrim stops above the bar: its keys stay live, as on the phone.
    '.dscrim { position: fixed; top: 0; left: 0; right: 0; bottom: calc(' + BAR_H + 'px + env(safe-area-inset-bottom, 0px));',
    '  z-index: 2147483002; background: rgba(0,0,0,.55); display: none; }',
    '.nobar .dscrim, .tucked .dscrim { bottom: 0; }',
    '.dscrim.on { display: block; }',
    '.dlg { position: fixed; z-index: 2147483003; left: 50%; top: 50%; transform: translate(-50%, -50%);',
    '  width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 120px); display: flex; flex-direction: column;',
    '  background: #1b1b1b; color: #fff; border: 1px solid #5a5a5a; border-radius: 4px; box-shadow: 0 10px 40px rgba(0,0,0,.6);',
    '  font-family: "Droid Sans", ui-sans-serif, system-ui, sans-serif; }',
    '.dlg-title { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 16px; font-size: 17px; font-weight: 700;',
    '  background: linear-gradient(180deg, #3a3a3a, #262626); border-bottom: 2px solid #9fd01d; }',
    '.dlg-title .tile { width: 32px; height: 32px; font-size: 18px; border-radius: 7px; transform: none; }',
    '.dlg-body { overflow-y: auto; padding: 4px 0; }',
    '.dlg-text { margin: 0; padding: 10px 16px; font-size: 14px; line-height: 1.45; color: #d8d8d8; }',
    '.dlg-meta { margin: 0; padding: 0 16px 12px; font-size: 13px; color: #a0a0a0; }',
    '.dlg-item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 0 16px;',
    '  border: 0; border-bottom: 1px solid #2e2e2e; background: none; color: #fff; font: inherit; font-size: 16px;',
    '  text-align: left; cursor: pointer; }',
    '.dlg-item:last-child { border-bottom: 0; }',
    '.dlg-item:hover, .dlg-item:focus-visible { background: #9fd01d; color: #000; outline: none; }',
    '.dlg-buttons { display: flex; gap: 8px; padding: 10px; background: #2a2a2a; border-top: 1px solid #3a3a3a; }',
    '.dlg-buttons button, .dlg-buttons a { flex: 1; min-height: 44px; border: 1px solid #666; border-radius: 4px;',
    '  background: linear-gradient(180deg, #f2f2f2, #c9c9c9); color: #111; font: inherit; font-size: 15px;',
    '  display: grid; place-items: center; text-decoration: none; cursor: pointer; }',
    '.dlg-buttons button:active, .dlg-buttons a:active { background: #9fd01d; }',
    '.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 4px; padding: 14px 8px; }',
    '.gtile { display: flex; flex-direction: column; align-items: center; gap: 6px; color: #fff; text-decoration: none;',
    '  font-size: 12px; text-align: center; border-radius: 6px; padding: 4px 2px; }',
    '.gtile span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.gtile:focus-visible { outline: 2px solid #9fd01d; }',
    '.gtile:active .tile { box-shadow: 0 0 0 3px #9fd01d; }',
    '.tile { --h: 95; --dl: 0%; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 12px;',
    '  font-size: 28px; line-height: 1; transform: perspective(160px) rotateX(9deg);',
    '  background: linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0) 48%),',
    '    linear-gradient(180deg, hsl(var(--h) 52% calc(58% + var(--dl))), hsl(var(--h) 58% calc(34% + var(--dl))));',
    '  box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 3px 6px rgba(0,0,0,.45); }',
    '.tile.custom { background: linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0) 48%), var(--tile); }',
    '.none { margin: 0; padding: 18px 16px; color: #a0a0a0; text-align: center; }',

    '.opts { position: fixed; left: 0; right: 0; z-index: 2147483003; bottom: calc(' + BAR_H + 'px + env(safe-area-inset-bottom, 0px));',
    '  display: grid; grid-template-columns: repeat(3, 1fr); background: linear-gradient(180deg, #3a3a3a, #1c1c1c);',
    '  border-top: 1px solid #6a6a6a; box-shadow: 0 -6px 24px rgba(0,0,0,.5);',
    '  font-family: "Droid Sans", ui-sans-serif, system-ui, sans-serif; }',
    '.opt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 76px;',
    '  border: 0; border-right: 1px solid #111; border-bottom: 1px solid #111; box-shadow: inset 1px 1px 0 rgba(255,255,255,.07);',
    '  background: none; color: #f0f0f0; font: inherit; font-size: 13px; cursor: pointer; padding: 6px 4px; }',
    '.opt svg { width: 28px; height: 28px; }',
    '.opt:nth-child(3n) { border-right: 0; }',
    '.opt:hover, .opt:focus-visible { background: rgba(159,208,29,.25); outline: none; }',
    '.opt:active { background: #9fd01d; color: #000; }',
    '.opt[disabled] { opacity: .45; cursor: default; background: none; }',
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
    ui.menu = el('button', { type: 'button', 'class': 'menu', 'aria-label': 'Menu', title: 'Menu',
      'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ICON.menu);
    ui.bar.appendChild(ui.back);
    ui.bar.appendChild(ui.home);
    ui.bar.appendChild(ui.recents);
    ui.bar.appendChild(ui.menu);
    ui.dscrim = el('div', { 'class': 'dscrim' });

    ui.toast = el('div', { 'class': 'toast', role: 'status', hidden: '' }, '<span></span><button type="button"></button>');
    ui.handle = el('button', { type: 'button', 'class': 'handle', 'aria-label': 'Show navigation' });

    wrap.appendChild(ui.scrim);
    wrap.appendChild(ui.sheet);
    wrap.appendChild(ui.toast);
    wrap.appendChild(ui.bar);
    wrap.appendChild(ui.handle);
    wrap.appendChild(ui.dscrim);
    root.appendChild(wrap);
    ui.wrap = wrap;
    ui.root = root;
    matchPage();
    watchPage();

    applyLook();
    if (isHub && !canGoBack()) ui.back.hidden = true;

    ui.back.addEventListener('click', function () {
      // Back closes what's open first, as on the phone.
      if (layer) { closeLayer(); return; }
      if (wrap.classList.contains('open')) { toggleTray(false); return; }
      if (canGoBack()) history.back();
      else location.href = HUB.href;
    });
    ui.menu.addEventListener('click', function () {
      if (layer && layer.kind === 'options') closeLayer();
      else openOptions();
    });
    ui.dscrim.addEventListener('click', function () { closeLayer(); });
    ui.home.addEventListener('click', function () {
      if (longPressed) { longPressed = false; return; }
      // On the retro launcher, Home is a launcher action: close whatever is
      // open and go back to the centre home screen (retro.js listens).
      if (isHub) { window.dispatchEvent(new CustomEvent('randomhome')); return; }
      location.href = HUB.href;
    });
    // Long-press ●: retro, Gingerbread's recent-apps dialog; modern, Share.
    onLongPress(ui.home, function () { if (look === 'retro') recentsDialog(); else share(); });
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
      // Tab stays inside an open dialog or panel.
      if (e.key === 'Tab' && layer) {
        var f = layer.node.querySelectorAll('button:not([disabled]), a[href]');
        if (!f.length) return;
        var cur = ui.root.activeElement;
        var i = Array.prototype.indexOf.call(f, cur);
        var next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === -1 || i === f.length - 1 ? 0 : i + 1);
        e.preventDefault();
        f[next].focus();
        return;
      }
      if (e.key !== 'Escape') return;
      if (layer) closeLayer();
      else if (wrap.classList.contains('open')) toggleTray(false);
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

  function share(target) {
    var known = target && target.slug ? target : (slug && ideaBySlug(slug));
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
    ui.wrap.classList.toggle('retro', look === 'retro');
    if (look === 'retro') retroFonts();
    else closeLayer();
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
    refreshBack: refreshBack,
    // A newer hub is waiting: updateReady() says so, applyUpdate() takes it.
    updateReady: function () { return !!pendingUpdate; },
    applyUpdate: function () { if (pendingUpdate) pendingUpdate(); },
    // Offline: the hub worker's saved (pinned) and cached ideas, and
    // saving one (loads it in a hidden frame unless it's this page).
    offlineStatus: offlineStatus,
    saveOffline: saveOffline,
    // Things that happened, for the launcher's notification shade.
    addEvent: addEvent,
    // Era dialogs, shared by the launcher and idea pages.
    menu: menuDialog,
    aboutIdea: aboutIdea,
    tileVars: tileVars
  };
  var pendingUpdate = null;

  /* ----------------------------------------------------------- tiles */

  // An idea's launcher tile colour: a hue from a stable FNV-1a hash of its
  // slug and a lightness step from other bits (or idea.json's "icon").
  function tileVars(idea) {
    if (idea.icon) return { custom: idea.icon };
    var h = 0x811c9dc5;
    for (var i = 0; i < idea.slug.length; i++) { h ^= idea.slug.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return { h: String(h % 360), dl: [0, -7, 6][(h >>> 9) % 3] + '%' };
  }
  function tileEl(idea) {
    var t = el('span', { 'class': 'tile', 'aria-hidden': 'true' });
    var v = tileVars(idea);
    if (v.custom) { t.classList.add('custom'); t.style.setProperty('--tile', v.custom); }
    else { t.style.setProperty('--h', v.h); t.style.setProperty('--dl', v.dl); }
    t.textContent = idea.emoji || '✦';
    return t;
  }

  var fontsAdded = false;
  function retroFonts() {
    if (fontsAdded) return;
    fontsAdded = true;
    var css = '';
    [['DroidSans', 400], ['DroidSans-Bold', 700]].forEach(function (f) {
      css += '@font-face{font-family:"Droid Sans";font-weight:' + f[1] + ';font-display:swap;src:url("' +
        new URL('fonts/' + f[0] + '.woff2', HUB).href + '") format("woff2")}';
    });
    var st = document.createElement('style');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------- era dialogs */

  // One layer at a time: a dialog or the options panel. Back, Escape and a
  // tap outside close it; focus goes back where it was.
  var layer = null;
  function openLayer(node, kind) {
    closeLayer();
    toggleTray(false);
    var active = (ui.root && ui.root.activeElement) || document.activeElement;
    ui.wrap.appendChild(node);
    ui.dscrim.classList.add('on');
    layer = { node: node, kind: kind, back: active };
    refreshBack();
    if (kind === 'options') ui.menu.setAttribute('aria-expanded', 'true');
    var first = node.querySelector('button:not([disabled]), a[href]');
    if (first) first.focus({ preventScroll: true });
  }
  function closeLayer() {
    if (!layer) return;
    var l = layer;
    layer = null;
    l.node.remove();
    ui.dscrim.classList.remove('on');
    ui.menu.setAttribute('aria-expanded', 'false');
    refreshBack();
    if (l.back && l.back.focus && document.contains(host)) {
      try { l.back.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  var dlgCount = 0;
  function dialog(title, opts) {
    opts = opts || {};
    var id = 'dlg-title-' + (++dlgCount);
    var d = el('div', { 'class': 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id });
    var h = el('h2', { 'class': 'dlg-title', id: id });
    if (opts.idea) h.appendChild(tileEl(opts.idea));
    h.appendChild(document.createTextNode(title));
    d.appendChild(h);
    var body = el('div', { 'class': 'dlg-body' });
    d.appendChild(body);
    if (opts.buttons && opts.buttons.length) {
      var row = el('div', { 'class': 'dlg-buttons' });
      opts.buttons.forEach(function (b) {
        var n = b.href ? el('a', { href: b.href }) : el('button', { type: 'button' });
        n.textContent = b.label;
        n.addEventListener('click', function () { if (b.run) b.run(); if (!b.keep) closeLayer(); });
        row.appendChild(n);
      });
      d.appendChild(row);
    }
    return { node: d, body: body };
  }

  // A Gingerbread context menu: a titled list of actions.
  function menuDialog(title, items, opts) {
    var dl = dialog(title, { idea: opts && opts.idea });
    items.filter(Boolean).forEach(function (it) {
      var b = el('button', { type: 'button', 'class': 'dlg-item', 'data-act': it.id || '' });
      b.textContent = it.label;
      b.addEventListener('click', function () { closeLayer(); it.run(); });
      dl.body.appendChild(b);
    });
    openLayer(dl.node, 'menu');
  }

  // Long-press ● (retro): the recent-ideas dialog, a 4 × 2 grid.
  function recentsDialog() {
    var list = lget(KEY.recents, []).filter(function (r) { return r && r.slug && r.slug !== slug; }).slice(0, 8);
    var dl = dialog('Recent', {});
    dl.node.setAttribute('data-kind', 'recents');
    if (!list.length) {
      var none = el('p', { 'class': 'none' });
      none.textContent = 'No recent ideas';
      dl.body.appendChild(none);
    } else {
      var grid = el('div', { 'class': 'grid4' });
      list.forEach(function (r) {
        var known = ideaBySlug(r.slug) || { slug: r.slug, title: r.title || r.slug, url: 'ideas/' + r.slug + '/' };
        var a = el('a', { 'class': 'gtile', href: new URL(known.url, HUB).href, 'data-slug': r.slug });
        a.appendChild(tileEl(known));
        var label = el('span');
        label.textContent = known.title;
        a.appendChild(label);
        grid.appendChild(a);
      });
      dl.body.appendChild(grid);
    }
    openLayer(dl.node, 'recents');
  }

  function offlineLine(idea, st) {
    if (idea.saveable === false) return 'Keeps itself offline';
    if (!st) return 'Offline status unavailable';
    if (st.saved.indexOf(idea.slug) !== -1) return 'Saved for offline';
    if (st.cached.indexOf(idea.slug) !== -1) return 'Cached (cleared first when space runs low)';
    return 'Not on this device yet';
  }

  // About this idea: tile, title, description, date added, offline status.
  function aboutIdea(idea) {
    var here = idea.slug === slug;
    var dl = dialog(idea.title, {
      idea: idea,
      buttons: [here ? null : { label: 'Open', href: new URL(idea.url, HUB).href }, { label: 'Close' }].filter(Boolean)
    });
    dl.node.setAttribute('data-kind', 'about');
    if (idea.description) {
      var p = el('p', { 'class': 'dlg-text' });
      p.textContent = idea.description;
      dl.body.appendChild(p);
    }
    var meta = el('p', { 'class': 'dlg-meta' });
    var added = idea.date ? 'Added ' + new Date(idea.date).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    meta.textContent = added + (added ? ' · ' : '') + 'Checking offline status…';
    dl.body.appendChild(meta);
    openLayer(dl.node, 'about');
    offlineStatus().then(function (st) { return st; }, function () { return null; }).then(function (st) {
      meta.textContent = added + (added ? ' · ' : '') + offlineLine(idea, st);
      meta.setAttribute('data-offline', st ? offlineLine(idea, st) : '');
    });
  }

  function aboutHub() {
    var dl = dialog('random', {
      idea: { slug: 'random', emoji: 'r', icon: 'linear-gradient(180deg, #e08554, #8f3d1e)' },
      buttons: [{ label: 'Source', href: 'https://github.com/rickymetz/random' }, { label: 'Close' }]
    });
    dl.node.setAttribute('data-kind', 'about-hub');
    var p = el('p', { 'class': 'dlg-text' });
    p.textContent = 'Small ideas, each one a tiny page.';
    dl.body.appendChild(p);
    var meta = el('p', { 'class': 'dlg-meta' });
    meta.textContent = (ideas ? ideas.length : 0) + ' ideas';
    dl.body.appendChild(meta);
    offlineStatus().then(function (st) {
      if (st && st.version) meta.textContent += ' · version ' + st.version;
    }, function () {});
    openLayer(dl.node, 'about');
  }

  // ≡ Menu: the Gingerbread options panel, a 3 × 2 grid.
  function openOptions() {
    var known = slug && ideaBySlug(slug);
    var retro = window.randomRetro;
    var items = isHub ? [
      { id: 'wallpaper', label: 'Wallpaper', icon: ICON.wallpaper, run: function () {
        if (!retro) return;
        var on = !retro.setting('motion');
        retro.setSetting('motion', on);
        toast('Wallpaper motion ' + (on ? 'on' : 'off'), null, 2000);
      } },
      { id: 'search', label: 'Search', icon: ICON.search, run: function () { window.dispatchEvent(new CustomEvent('randomsearch')); } },
      { id: 'settings', label: 'Settings', icon: ICON.settings, run: openSettings },
      { id: 'look', label: 'Modern look', icon: ICON.look, run: function () { setLook('modern'); } },
      { id: 'share', label: 'Share', icon: ICON.share, run: function () { share(); } },
      { id: 'about', label: 'About', icon: ICON.about, run: aboutHub }
    ] : [
      { id: 'share', label: 'Share', icon: ICON.share, run: function () { share(); } },
      known && known.saveable !== false
        ? { id: 'save', label: 'Save offline', icon: ICON.save, run: function () { toggleSaved(known); } }
        : { id: 'save', label: 'Works offline', icon: ICON.saved, disabled: !known || known.saveable === false },
      { id: 'about', label: 'About', icon: ICON.about, disabled: !known, run: function () { aboutIdea(known); } },
      { id: 'settings', label: 'Settings', icon: ICON.settings, run: openSettings },
      { id: 'home', label: 'Home', icon: ICON.hub, run: function () { location.href = HUB.href; } },
      { id: 'look', label: 'Modern look', icon: ICON.look, run: function () { setLook('modern'); } }
    ];
    var panel = el('div', { 'class': 'opts', role: 'menu', 'aria-label': 'Options' });
    items.forEach(function (it) {
      var b = el('button', { type: 'button', 'class': 'opt', role: 'menuitem', 'data-opt': it.id }, it.icon);
      var l = el('span');
      l.textContent = it.label;
      b.appendChild(l);
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', function () { closeLayer(); if (it.run) it.run(); });
      panel.appendChild(b);
    });
    openLayer(panel, 'options');
    // Reflect whether this idea is already saved.
    var saveBtn = panel.querySelector('[data-opt="save"]:not([disabled])');
    if (saveBtn) offlineStatus().then(function (st) {
      if (st && st.saved.indexOf(known.slug) !== -1) {
        saveBtn.querySelector('span').textContent = 'Saved ✓';
        saveBtn.setAttribute('aria-pressed', 'true');
      }
    }, function () {});
  }

  function openSettings() {
    if (isHub) window.dispatchEvent(new CustomEvent('randomsettings'));
    else location.href = HUB.href + '#settings';
  }

  function toggleSaved(idea) {
    offlineStatus().then(function (st) {
      var on = !(st && st.saved.indexOf(idea.slug) !== -1);
      toast(on ? 'Saving ' + idea.title + '…' : 'Removing…', null, 0);
      return saveOffline(idea.slug, on).then(function () {
        toast(on ? 'Saved for offline' : 'No longer saved', null, 2200);
      });
    }).catch(function () { toast("Couldn't reach offline storage", null, 2600); });
  }

  /* ------------------------------------------------ offline, events */

  function ask(msg) {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('no worker'));
    return navigator.serviceWorker.getRegistration(HUB.href).then(function (reg) {
      var worker = reg && reg.active;
      if (!worker) throw new Error('no worker');
      return new Promise(function (resolve, reject) {
        var channel = new MessageChannel();
        var timer = setTimeout(function () { reject(new Error('timeout')); }, 10000);
        channel.port1.onmessage = function (e) { clearTimeout(timer); resolve(e.data); };
        worker.postMessage(msg, [channel.port2]);
      });
    });
  }
  function offlineStatus() { return ask({ type: 'STATUS' }); }

  // Open the idea in a hidden frame, so the hub worker sees — and caches —
  // every file it loads, exactly as a visit would. (nav.js stays out of
  // frames, so this doesn't count as opening it.)
  function loadHidden(url) {
    return new Promise(function (resolve) {
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:844px;border:0;visibility:hidden;';
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        // A moment for what the idea fetches after load (data files).
        setTimeout(function () { frame.remove(); resolve(); }, 2500);
      }
      frame.addEventListener('load', finish);
      setTimeout(finish, 20000);
      frame.src = url;
      document.body.appendChild(frame);
    });
  }

  function saveOffline(s, on) {
    return ideasReady.then(function () {
      var idea = ideaBySlug(s);
      return on && s !== slug && idea ? loadHidden(new URL(idea.url, HUB).href) : null;
    }).then(function () { return ask({ type: 'PIN', slug: s, on: !!on }); }).then(function (st) {
      if (on) addEvent({ id: 'saved:' + s, type: 'saved', slug: s });
      return st;
    });
  }

  function addEvent(ev) {
    var list = lget(KEY.events, []).filter(function (e) { return e && e.id !== ev.id; });
    ev.at = ev.at || new Date().toISOString();
    list.unshift(ev);
    lset(KEY.events, list.slice(0, 12));
    lset(KEY.dismissed, lget(KEY.dismissed, []).filter(function (d) { return d !== ev.id; }));
    try { window.dispatchEvent(new CustomEvent('randomevent', { detail: ev })); } catch (e) {}
  }

  // On the hub Back hides when there's nowhere to go, but never while a
  // dialog, the options panel or the tray is open: then it closes them.
  function refreshBack() {
    if (ui.back && isHub) ui.back.hidden = !canGoBack() && !layer && !(ui.wrap && ui.wrap.classList.contains('open'));
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
    refreshBack();
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
        pendingUpdate = function () {
          worker.addEventListener('statechange', function () {
            if (worker.state === 'activated' && !refreshing) { refreshing = true; location.reload(); }
          });
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
        toast('New ideas available', { label: 'Refresh', run: pendingUpdate });
        // The retro launcher also lists it in its notification shade.
        try { window.dispatchEvent(new CustomEvent('randomupdate')); } catch (e) {}
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
