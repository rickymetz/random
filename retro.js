/* random — the retro (Gingerbread) launcher.
 *
 * Draws the installed hub as an early-Android home: three swipeable home
 * screens holding every idea as an era icon, page dots, a dock with the
 * app-drawer button and two favourites, and the drawer itself. It is only
 * drawn while the look is 'retro' (nav.js owns the look and fires a
 * 'randomlook' event when it changes); the modern hub markup is untouched.
 * Spec: docs/superpowers/specs/2026-09-23-hub-gingerbread-retro.md
 */
(function () {
  'use strict';

  var nav = window.randomNav;
  var root = document.getElementById('retro');
  if (!nav || !root) return;

  var KEY = {
    dock: 'random-hub:dock',
    sort: 'random-hub:drawer-sort'
  };
  var PAGES = 3;
  var CENTRE = 1;
  var PER_PAGE = 16; // a 4 × 4 grid; later widgets take cells from it
  // Tile colour: a hue from a stable hash of the slug, and one of three
  // lightness steps from other bits of it, so neighbours stay distinct.
  var LIGHT_STEPS = [0, -7, 6];

  function lget(k, f) {
    try { var v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; }
  }
  function lset(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  }
  function hash(s) { // FNV-1a, 32-bit
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
  }

  var ideas = [];
  var ui = {};
  var mounted = false;
  var themeMetas = [];

  /* ------------------------------------------------------------ icons */

  function icon(idea, opts) {
    var a = el('a', 'rt-icon', { href: idea.url, 'data-slug': idea.slug });
    var tile = el('span', 'rt-tile', { 'aria-hidden': 'true' });
    if (idea.icon) {
      tile.classList.add('rt-custom');
      tile.style.setProperty('--tile', idea.icon);
    } else {
      var h = hash(idea.slug);
      tile.style.setProperty('--h', String(h % 360));
      tile.style.setProperty('--dl', LIGHT_STEPS[(h >>> 9) % 3] + '%');
    }
    tile.textContent = idea.emoji || '✦';
    var label = el('span', 'rt-label');
    label.textContent = idea.title;
    a.appendChild(tile);
    a.appendChild(label);
    if (nav.isNew(idea) && !(opts && opts.noNew)) {
      a.appendChild(el('i', 'rt-new', { title: 'New' }));
      a.setAttribute('aria-label', idea.title + ' (new)');
    }
    return a;
  }

  /* ------------------------------------------------------- home screens */

  // Ideas flow newest first: the centre screen, then the right, then the
  // left, so the first screen you see is full before any other is.
  var FLOW = [CENTRE, 2, 0];

  function buildPages() {
    ui.pages = el('div', 'rt-pages', { role: 'region', 'aria-label': 'Home screens', tabindex: '-1' });
    ui.page = [];
    ui.grid = [];
    for (var p = 0; p < PAGES; p++) {
      var page = el('section', 'rt-page', { 'data-page': String(p), 'aria-label': 'Home screen ' + (p + 1) + ' of ' + PAGES });
      var grid = el('div', 'rt-grid');
      page.appendChild(grid);
      ui.pages.appendChild(page);
      ui.page.push(page);
      ui.grid.push(grid);
    }
    fillPages();

    ui.dots = el('div', 'rt-dots', { role: 'group', 'aria-label': 'Home screens' });
    for (var d = 0; d < PAGES; d++) {
      var dot = el('button', '', { type: 'button', 'aria-label': 'Home screen ' + (d + 1) });
      dot.addEventListener('click', goTo.bind(null, d, true));
      ui.dots.appendChild(dot);
    }

    ui.pages.addEventListener('scroll', onScroll, { passive: true });
    ui.pages.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { goTo(Math.min(PAGES - 1, currentPage() + 1), true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { goTo(Math.max(0, currentPage() - 1), true); e.preventDefault(); }
    });
  }

  function fillPages() {
    ui.grid.forEach(function (g) { g.textContent = ''; });
    var i = 0;
    FLOW.forEach(function (p, n) {
      var room = n === FLOW.length - 1 ? Infinity : PER_PAGE; // the last page scrolls
      for (var c = 0; c < room && i < ideas.length; c++, i++) ui.grid[p].appendChild(icon(ideas[i]));
    });
  }

  function currentPage() {
    var w = ui.pages.clientWidth || 1;
    return Math.round(ui.pages.scrollLeft / w);
  }
  function goTo(p, smooth) {
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ui.pages.scrollTo({ left: p * ui.pages.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    markDot(p);
  }
  function markDot(p) {
    Array.prototype.forEach.call(ui.dots.children, function (b, i) {
      b.setAttribute('aria-current', i === p ? 'true' : 'false');
    });
  }
  var scrollTimer = null;
  function onScroll() {
    markDot(currentPage());
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () { markDot(currentPage()); }, 120);
  }

  /* --------------------------------------------------------------- dock */

  // Two favourites: the saved dock, else the two most recently opened
  // ideas, else the two newest.
  function dockSlugs() {
    var known = function (s) { return ideas.some(function (i) { return i.slug === s; }); };
    var saved = (lget(KEY.dock, null) || []).filter(known);
    if (saved.length) return saved.slice(0, 2);
    var recent = nav.recents().map(function (r) { return r.slug; }).filter(known);
    var picks = recent.slice(0, 2);
    ideas.forEach(function (i) { if (picks.length < 2 && picks.indexOf(i.slug) === -1) picks.push(i.slug); });
    return picks;
  }

  function buildDock() {
    ui.dock = el('div', 'rt-dock', { role: 'toolbar', 'aria-label': 'Dock' });
    ui.slot = [el('div', 'rt-dock-slot'), el('div', 'rt-dock-slot')];
    ui.launcher = el('button', 'rt-launcher', { type: 'button', 'aria-label': 'All ideas', 'aria-expanded': 'false' });
    // Gingerbread's launcher key: a 4 × 4 grid of dots.
    var dots = '';
    for (var y = 0; y < 4; y++) for (var x = 0; x < 4; x++) {
      dots += '<circle cx="' + (5 + x * 6.7) + '" cy="' + (5 + y * 6.7) + '" r="1.9"/>';
    }
    ui.launcher.innerHTML = '<svg viewBox="0 0 30 30" fill="#e8e8e8" aria-hidden="true">' + dots + '</svg>';
    ui.launcher.addEventListener('click', function () { openDrawer(); });
    ui.dock.appendChild(ui.slot[0]);
    ui.dock.appendChild(ui.launcher);
    ui.dock.appendChild(ui.slot[1]);
    fillDock();
  }

  function fillDock() {
    var slugs = dockSlugs();
    ui.slot.forEach(function (slot, i) {
      slot.textContent = '';
      var idea = ideas.filter(function (d) { return d.slug === slugs[i]; })[0];
      if (idea) slot.appendChild(icon(idea, { noNew: true }));
    });
  }

  /* ------------------------------------------------------------- drawer */

  function sortOrder() { return lget(KEY.sort, 'az') === 'new' ? 'new' : 'az'; }

  function buildDrawer() {
    ui.drawer = el('div', 'rt-drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All ideas', 'aria-hidden': 'true' });
    var head = el('div', 'rt-drawer-head');
    var h = el('h2');
    h.textContent = 'All ideas';
    var sort = el('div', 'rt-sort', { role: 'group', 'aria-label': 'Sort' });
    ui.sortAz = el('button', '', { type: 'button', 'data-sort': 'az' });
    ui.sortAz.textContent = 'A–Z';
    ui.sortNew = el('button', '', { type: 'button', 'data-sort': 'new' });
    ui.sortNew.textContent = 'Newest';
    [ui.sortAz, ui.sortNew].forEach(function (b) {
      b.addEventListener('click', function () { lset(KEY.sort, b.getAttribute('data-sort')); fillDrawer(); });
      sort.appendChild(b);
    });
    head.appendChild(h);
    head.appendChild(sort);
    var body = el('div', 'rt-drawer-body');
    ui.drawerGrid = el('div', 'rt-grid');
    body.appendChild(ui.drawerGrid);
    ui.drawer.appendChild(head);
    ui.drawer.appendChild(body);
    ui.drawer.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); }
    });
    fillDrawer();
  }

  function fillDrawer() {
    var order = sortOrder();
    ui.sortAz.setAttribute('aria-pressed', order === 'az' ? 'true' : 'false');
    ui.sortNew.setAttribute('aria-pressed', order === 'new' ? 'true' : 'false');
    var list = ideas.slice();
    if (order === 'az') list.sort(function (a, b) { return a.title.localeCompare(b.title); });
    ui.drawerGrid.textContent = '';
    list.forEach(function (idea) { ui.drawerGrid.appendChild(icon(idea)); });
  }

  function drawerOpen() { return ui.drawer && ui.drawer.classList.contains('rt-open'); }

  // The drawer is a history entry, so the bar's Back (and the system's)
  // closes it, as on a phone.
  function openDrawer() {
    if (drawerOpen()) return;
    history.pushState({ rt: 'drawer' }, '');
    showDrawer(true);
  }
  function closeDrawer() {
    if (!drawerOpen()) return;
    if (history.state && history.state.rt === 'drawer') history.back(); // popstate hides it
    else showDrawer(false);
  }
  function showDrawer(on) {
    ui.drawer.classList.toggle('rt-open', on);
    ui.drawer.setAttribute('aria-hidden', on ? 'false' : 'true');
    ui.launcher.setAttribute('aria-expanded', on ? 'true' : 'false');
    ui.pages.inert = on;
    ui.dock.inert = on;
    if (nav.refreshBack) nav.refreshBack();
    if (on) {
      var first = ui.drawerGrid.querySelector('.rt-icon');
      (first || ui.drawer).focus({ preventScroll: true });
    } else if (ui.drawer.contains(document.activeElement)) {
      ui.launcher.focus({ preventScroll: true });
    }
  }
  window.addEventListener('popstate', function () {
    if (!mounted) return;
    var wantDrawer = !!(history.state && history.state.rt === 'drawer');
    if (wantDrawer !== drawerOpen()) showDrawer(wantDrawer);
  });

  // The bar's ● on the launcher: close whatever is open, back to centre.
  window.addEventListener('randomhome', function () {
    if (!mounted) return;
    if (drawerOpen()) closeDrawer();
    goTo(CENTRE, true);
  });

  /* ------------------------------------------------------ mount, look */

  // The device's own status bar is painted black under the retro look, so
  // ours (and the launcher) sit beneath it as one piece of hardware.
  function paintSystemBar(retro) {
    if (!themeMetas.length) {
      themeMetas = Array.prototype.map.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) {
        return { meta: m, content: m.getAttribute('content') };
      });
    }
    themeMetas.forEach(function (t) { t.meta.setAttribute('content', retro ? '#000000' : t.content); });
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    root.hidden = false;
    paintSystemBar(true);
    nav.ideas().then(function (list) {
      if (!mounted) return;
      ideas = (list || []).slice();
      root.textContent = '';
      buildPages();
      buildDock();
      buildDrawer();
      root.appendChild(ui.pages);
      root.appendChild(ui.dots);
      root.appendChild(ui.dock);
      root.appendChild(ui.drawer);
      // Open on the centre screen, after layout gives the pages a width.
      requestAnimationFrame(function () { goTo(CENTRE, false); });
      if (history.state && history.state.rt === 'drawer') showDrawer(true);
      root.setAttribute('data-ready', '');
    });
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    root.hidden = true;
    root.removeAttribute('data-ready');
    root.textContent = '';
    ui = {};
    paintSystemBar(false);
  }

  function onLook() {
    if (nav.look() === 'retro') mount();
    else unmount();
  }
  window.addEventListener('randomlook', onLook);
  onLook();
})();
