/* random — the retro (Gingerbread) launcher.
 *
 * Draws the installed hub as an early-Android home: a status bar with a
 * pull-down notification shade, a live wallpaper, three swipeable home
 * screens holding every idea as an era icon beside four widgets (search,
 * clock, new ideas, power control), page dots, a dock with the app-drawer
 * button and two favourites, the drawer, a Settings app, a boot animation
 * on a cold start and a zoom into each idea you open. It is only
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
    sort: 'random-hub:drawer-sort',
    clock: 'random-hub:clock',
    sounds: 'random-hub:sounds',
    haptics: 'random-hub:haptics',
    motion: 'random-hub:wallpaper-motion',
    events: 'random-hub:events',
    dismissed: 'random-hub:shade-dismissed'
  };
  var PAGES = 3;
  var CENTRE = 1;
  // Icons per screen after its widgets (the centre has search and clock,
  // the right the power control); the last screen in the flow scrolls.
  var ROOM = { 1: 8, 2: 12, 0: Infinity };

  // Settings the widgets and Settings share. Defaults: haptics on, sounds
  // off, wallpaper moving.
  var DEFAULTS = { sounds: false, haptics: true, motion: true };
  function setting(name) { var v = lget(KEY[name], null); return typeof v === 'boolean' ? v : DEFAULTS[name]; }
  function setSetting(name, on) {
    lset(KEY[name], !!on);
    try { window.dispatchEvent(new CustomEvent('randomsetting', { detail: { name: name, on: !!on } })); } catch (e) {}
  }

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

  var ideas = [];
  var ui = {};
  var mounted = false;
  var themeMetas = [];
  var clockTimer = 0;

  /* ------------------------------------------------------------ icons */

  function icon(idea, opts) {
    var a = el('a', 'rt-icon', { href: idea.url, 'data-slug': idea.slug });
    var tile = el('span', 'rt-tile', { 'aria-hidden': 'true' });
    var v = nav.tileVars(idea); // shared with nav.js's dialogs
    if (v.custom) {
      tile.classList.add('rt-custom');
      tile.style.setProperty('--tile', v.custom);
    } else {
      tile.style.setProperty('--h', v.h);
      tile.style.setProperty('--dl', v.dl);
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
    // Widgets first, each spanning the grid's width.
    ui.grid[CENTRE].appendChild(searchWidget());
    ui.grid[CENTRE].appendChild(clockWidget());
    ui.grid[0].appendChild(newIdeasWidget());
    ui.grid[2].appendChild(powerWidget());
    var i = 0;
    FLOW.forEach(function (p) {
      for (var c = 0; c < ROOM[p] && i < ideas.length; c++, i++) ui.grid[p].appendChild(icon(ideas[i]));
    });
  }

  // Timers and frames can outlive the launcher (the look switched to modern
  // mid-swipe): everything below checks it is still there.
  function currentPage() {
    if (!ui.pages) return CENTRE;
    var w = ui.pages.clientWidth || 1;
    return Math.round(ui.pages.scrollLeft / w);
  }
  function goTo(p, smooth) {
    if (!ui.pages) return;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ui.pages.scrollTo({ left: p * ui.pages.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    markDot(p);
  }
  function markDot(p) {
    if (!ui.dots) return;
    Array.prototype.forEach.call(ui.dots.children, function (b, i) {
      b.setAttribute('aria-current', i === p ? 'true' : 'false');
    });
  }
  var scrollTimer = null;
  var lastPage = CENTRE;
  function onScroll() {
    var p = currentPage();
    if (p !== lastPage) { lastPage = p; nav.feedback('swipe'); }
    markDot(p);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () { markDot(currentPage()); }, 120);
  }

  /* ------------------------------------------------------------ widgets */

  function widget(cls, label) {
    return el('div', 'rt-widget ' + cls, { role: 'group', 'aria-label': label });
  }

  // Search: filters ideas by title and description as you type; Enter
  // opens the top match.
  function searchWidget() {
    var w = widget('rt-search', 'Search ideas');
    var form = el('form', 'rt-search-box', { role: 'search' });
    form.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M14.6 14.6L20 20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    var input = el('input', '', { type: 'search', placeholder: 'Search ideas', 'aria-label': 'Search ideas',
      autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go' });
    form.appendChild(input);
    var results = el('div', 'rt-results', { role: 'listbox', 'aria-label': 'Matching ideas', hidden: '' });
    w.appendChild(form);
    w.appendChild(results);
    ui.search = input;

    function matches(q) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      return ideas.filter(function (i) {
        return (i.title + ' ' + (i.description || '')).toLowerCase().indexOf(q) !== -1;
      });
    }
    function render() {
      var list = matches(input.value);
      results.textContent = '';
      results.hidden = !input.value.trim();
      if (!list.length) {
        var none = el('p', 'rt-results-none');
        none.textContent = 'No ideas match';
        results.appendChild(none);
        return;
      }
      list.forEach(function (idea) {
        var a = el('a', 'rt-result', { href: idea.url, role: 'option', 'data-slug': idea.slug });
        var e = el('span', 'rt-result-emoji', { 'aria-hidden': 'true' });
        e.textContent = idea.emoji || '✦';
        var t = el('span', 'rt-result-title');
        t.textContent = idea.title;
        a.appendChild(e);
        a.appendChild(t);
        results.appendChild(a);
      });
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; render(); input.blur(); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var top = matches(input.value)[0];
      if (top) location.href = new URL(top.url, location.href).href;
    });
    return w;
  }

  // Clock: big digital or glossy analog; a tap flips it (remembered).
  function clockWidget() {
    var w = el('button', 'rt-widget rt-clock', { type: 'button', 'aria-label': 'Clock. Tap to switch style' });
    ui.clock = w;
    paintClock();
    w.addEventListener('click', function () {
      lset(KEY.clock, clockStyle() === 'analog' ? 'digital' : 'analog');
      paintClock();
    });
    return w;
  }
  function clockStyle() { return lget(KEY.clock, 'digital') === 'analog' ? 'analog' : 'digital'; }
  function paintClock() {
    if (!ui.clock) return;
    var now = new Date();
    var style = clockStyle();
    ui.clock.setAttribute('data-style', style);
    var time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (style === 'digital') {
      ui.clock.innerHTML = '<span class="rt-clock-time"></span><span class="rt-clock-date"></span>';
      ui.clock.firstChild.textContent = time;
      ui.clock.lastChild.textContent = date;
    } else {
      var h = now.getHours() % 12, m = now.getMinutes();
      var ha = (h + m / 60) * 30, ma = m * 6;
      var ticks = '';
      for (var i = 0; i < 12; i++) {
        ticks += '<line x1="50" y1="9" x2="50" y2="' + (i % 3 ? 14 : 18) + '" transform="rotate(' + i * 30 + ' 50 50)"/>';
      }
      ui.clock.innerHTML =
        '<svg class="rt-analog" viewBox="0 0 100 100" aria-hidden="true">' +
        '<defs><radialGradient id="rt-face" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#fdfdfd"/><stop offset=".7" stop-color="#cfd3d6"/><stop offset="1" stop-color="#8e9499"/></radialGradient></defs>' +
        '<circle cx="50" cy="50" r="47" fill="#1a1a1a"/><circle cx="50" cy="50" r="43" fill="url(#rt-face)"/>' +
        '<g stroke="#333" stroke-width="2" stroke-linecap="round">' + ticks + '</g>' +
        '<line x1="50" y1="50" x2="50" y2="27" stroke="#222" stroke-width="4.5" stroke-linecap="round" transform="rotate(' + ha + ' 50 50)"/>' +
        '<line x1="50" y1="50" x2="50" y2="15" stroke="#222" stroke-width="2.6" stroke-linecap="round" transform="rotate(' + ma + ' 50 50)"/>' +
        '<circle cx="50" cy="50" r="3.2" fill="#9fd01d"/>' +
        '<ellipse cx="42" cy="30" rx="26" ry="14" fill="#fff" opacity=".35"/></svg>' +
        '<span class="rt-clock-date"></span>';
      ui.clock.lastChild.textContent = time + ' · ' + date;
    }
  }

  // New ideas: up to three added since your first visit and not yet opened.
  function newIdeasWidget() {
    var w = widget('rt-panel-widget rt-news', 'New ideas');
    var h = el('h3');
    h.textContent = 'New ideas';
    w.appendChild(h);
    var fresh = ideas.filter(function (i) { return nav.isNew(i); }).slice(0, 3);
    if (!fresh.length) {
      var p = el('p', 'rt-muted');
      p.textContent = 'No new ideas';
      w.appendChild(p);
    }
    fresh.forEach(function (idea) {
      var a = el('a', 'rt-news-item', { href: idea.url, 'data-slug': idea.slug });
      var e = el('span', 'rt-result-emoji', { 'aria-hidden': 'true' });
      e.textContent = idea.emoji || '✦';
      var t = el('span');
      t.textContent = idea.title;
      a.appendChild(e);
      a.appendChild(t);
      w.appendChild(a);
    });
    return w;
  }

  // Power control: a row of toggles, each with a lit bar when on.
  var POWER = [
    { id: 'look', label: 'Retro look', glyph: '<rect x="6" y="3" width="12" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17.5" r="1.3" fill="currentColor"/>' },
    { id: 'sounds', label: 'Sounds', glyph: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
    { id: 'haptics', label: 'Haptic feedback', glyph: '<rect x="8" y="4" width="8" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 8v8M19.5 8v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
    { id: 'motion', label: 'Wallpaper motion', glyph: '<circle cx="7" cy="15" r="2" fill="currentColor"/><circle cx="14" cy="8" r="1.6" fill="currentColor"/><circle cx="18" cy="16" r="1.2" fill="currentColor"/><path d="M4 20c5-1 11-6 16-15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 3"/>' },
    { id: 'storage', label: 'Storage', glyph: '<ellipse cx="12" cy="6" rx="7" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' }
  ];
  function powerOn(id) {
    if (id === 'look') return nav.look() === 'retro';
    if (id === 'storage') return false;
    return setting(id);
  }
  function powerWidget() {
    var w = widget('rt-power', 'Power control');
    POWER.forEach(function (p) {
      var b = el('button', 'rt-power-key', { type: 'button', 'data-power': p.id, 'aria-label': p.label, title: p.label });
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + p.glyph + '</svg><i aria-hidden="true"></i>';
      if (p.id !== 'storage') b.setAttribute('aria-pressed', powerOn(p.id) ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (p.id === 'look') { nav.setLook('modern'); return; }
        if (p.id === 'storage') { showStorage(); return; }
        setSetting(p.id, !setting(p.id));
        b.setAttribute('aria-pressed', setting(p.id) ? 'true' : 'false');
        nav.toast(p.label + (setting(p.id) ? ' on' : ' off'));
      });
      w.appendChild(b);
    });
    return w;
  }
  function showStorage() { openSettings('storage'); }

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
    wallpaperPaused(on);
    if (on) {
      var first = ui.drawerGrid.querySelector('.rt-icon');
      (first || ui.drawer).focus({ preventScroll: true });
    } else if (ui.drawer.contains(document.activeElement)) {
      ui.launcher.focus({ preventScroll: true });
    }
  }
  window.addEventListener('popstate', function () {
    if (!mounted || !ui.drawer) return;
    var state = history.state && history.state.rt;
    if ((state === 'drawer') !== drawerOpen()) showDrawer(state === 'drawer');
    if ((state === 'shade') !== shadeOpen()) showShade(state === 'shade');
    if ((state === 'settings') !== settingsOpen()) showSettings(state === 'settings');
  });

  // The bar's ● on the launcher: close whatever is open, back to centre.
  window.addEventListener('randomhome', function () {
    if (!mounted || !ui.drawer) return;
    // Unwind every launcher layer in one go (shade over drawer is two
    // history entries).
    var steps = 0;
    if (shadeOpen()) { if (history.state && history.state.rt === 'shade') steps++; else showShade(false); }
    if (settingsOpen()) steps++;
    if (drawerOpen()) steps++;
    if (steps) history.go(-steps);
    if (ui.search) { ui.search.value = ''; ui.search.dispatchEvent(new Event('input')); }
    goTo(CENTRE, true);
  });

  /* ---------------------------------------------------- status bar, shade */

  // Events the shade lists that aren't derived from live state: things that
  // happened (an idea saved for offline). Newest first, a dozen at most.
  function events() { return lget(KEY.events, []); }
  function notify(ev) { nav.addEvent(ev); } // nav.js stores it and fires 'randomevent'
  function dismissed() { return lget(KEY.dismissed, []); }
  function dismiss(ids) {
    var d = dismissed();
    ids.forEach(function (id) { if (d.indexOf(id) === -1) d.push(id); });
    lset(KEY.dismissed, d.slice(-200));
  }

  // Everything the shade shows right now: ongoing state (offline, an update
  // waiting) and notifications (new ideas, events), minus dismissed ones.
  function shadeItems() {
    var gone = dismissed();
    var ongoing = [];
    if (!navigator.onLine) ongoing.push({ id: 'offline', icon: '⚠', title: "You're offline", text: 'Saved and cached ideas still open.' });
    if (nav.updateReady && nav.updateReady()) {
      ongoing.push({ id: 'update', icon: '⟳', title: 'Update ready', text: 'Tap to refresh with the newest ideas.', run: function () { nav.applyUpdate(); } });
    }
    var notes = [];
    ideas.filter(function (i) { return nav.isNew(i); }).forEach(function (idea) {
      notes.push({ id: 'new:' + idea.slug, icon: idea.emoji || '✦', title: 'New idea: ' + idea.title,
        text: idea.description || '', href: idea.url });
    });
    events().forEach(function (e) {
      if (e.type === 'saved') {
        var idea = ideas.filter(function (i) { return i.slug === e.slug; })[0];
        if (idea) notes.push({ id: e.id, icon: '⤓', title: 'Saved for offline', text: idea.title + ' works without a connection.', href: idea.url });
      }
    });
    return {
      ongoing: ongoing,
      notes: notes.filter(function (n) { return gone.indexOf(n.id) === -1; })
    };
  }

  function buildStatusBar() {
    ui.status = el('div', 'rt-status', { role: 'button', tabindex: '0', 'aria-label': 'Notifications. Pull down or tap to open', 'aria-expanded': 'false' });
    ui.statusNotes = el('span', 'rt-status-notes', { 'aria-hidden': 'true' });
    var right = el('span', 'rt-status-right');
    ui.statusNet = el('span', 'rt-status-net');
    ui.statusBattery = el('span', 'rt-status-battery', { hidden: '' });
    ui.statusClock = el('span', 'rt-status-clock');
    right.appendChild(ui.statusNet);
    right.appendChild(ui.statusBattery);
    right.appendChild(ui.statusClock);
    ui.status.appendChild(ui.statusNotes);
    ui.status.appendChild(right);

    // Pull down (or tap, or Enter) to open the shade.
    var startY = null;
    ui.status.addEventListener('pointerdown', function (e) { startY = e.clientY; });
    ui.status.addEventListener('pointermove', function (e) {
      if (startY != null && e.clientY - startY > 24) { startY = null; openShade(); }
    });
    ui.status.addEventListener('pointerup', function () { if (startY != null) { startY = null; openShade(); } });
    ui.status.addEventListener('pointercancel', function () { startY = null; });
    ui.status.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openShade(); }
    });

    paintNet();
    watchBattery();
  }

  function paintNet() {
    if (!ui.statusNet) return;
    var on = navigator.onLine;
    ui.statusNet.setAttribute('data-online', on ? 'true' : 'false');
    ui.statusNet.setAttribute('title', on ? 'Online' : 'Offline');
    ui.statusNet.innerHTML = on
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 13h2.5v2H1zM5 10h2.5v5H5zM9 7h2.5v8H9zM13 3h2.5v12H13z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 13h2.5v2H1zM5 10h2.5v5H5zM9 7h2.5v8H9zM13 3h2.5v12H13z" fill="currentColor" opacity=".3"/><path d="M2 2l12 12" stroke="currentColor" stroke-width="1.6"/></svg>';
  }

  // Battery only where the browser really reports it; never a made-up one.
  var batteryWatched = false;
  function watchBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      paint();
      if (batteryWatched) return;
      batteryWatched = true;
      b.addEventListener('levelchange', paint);
      b.addEventListener('chargingchange', paint);
      function paint() {
        if (!ui.statusBattery) return;
        var pct = Math.round(b.level * 100);
        ui.statusBattery.hidden = false;
        ui.statusBattery.setAttribute('title', 'Battery ' + pct + '%' + (b.charging ? ', charging' : ''));
        ui.statusBattery.innerHTML =
          '<svg viewBox="0 0 12 20" aria-hidden="true"><rect x="3.5" y="0.5" width="5" height="2" rx=".6" fill="currentColor"/>' +
          '<rect x="0.8" y="2.3" width="10.4" height="16.9" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
          '<rect x="2.3" y="' + (3.8 + 13.9 * (1 - b.level)).toFixed(2) + '" width="7.4" height="' + (13.9 * b.level).toFixed(2) +
          '" fill="' + (b.level <= 0.15 && !b.charging ? '#e5452e' : '#9fd01d') + '"/>' +
          (b.charging ? '<path d="M6.8 5L3.8 11h2.4l-1 4.2L8.4 9H6z" fill="#000"/>' : '') + '</svg>';
      }
    }).catch(function () {});
  }

  function paintStatusClock() {
    if (ui.statusClock) ui.statusClock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function buildShade() {
    ui.shade = el('div', 'rt-shade', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Notifications', 'aria-hidden': 'true' });
    var head = el('div', 'rt-shade-head');
    ui.shadeDate = el('span', 'rt-shade-date');
    ui.shadeClear = el('button', 'rt-shade-clear', { type: 'button' });
    ui.shadeClear.textContent = 'Clear';
    ui.shadeClear.addEventListener('click', function () {
      dismiss(shadeItems().notes.map(function (n) { return n.id; }));
      refreshShade();
    });
    head.appendChild(ui.shadeDate);
    head.appendChild(ui.shadeClear);
    ui.shadeBody = el('div', 'rt-shade-body');
    var handle = el('button', 'rt-shade-handle', { type: 'button', 'aria-label': 'Close notifications' });
    handle.addEventListener('click', function () { closeShade(); });
    // Drag the handle up to close.
    var startY = null;
    handle.addEventListener('pointerdown', function (e) { startY = e.clientY; });
    handle.addEventListener('pointermove', function (e) { if (startY != null && startY - e.clientY > 24) { startY = null; closeShade(); } });
    ui.shade.appendChild(head);
    ui.shade.appendChild(ui.shadeBody);
    ui.shade.appendChild(handle);
    ui.shade.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closeShade(); } });
    refreshShade();
  }

  function shadeRow(item) {
    var tag = item.href ? 'a' : 'button';
    var row = el(tag, 'rt-note', item.href ? { href: item.href, 'data-note': item.id } : { type: 'button', 'data-note': item.id });
    var ic = el('span', 'rt-note-icon', { 'aria-hidden': 'true' });
    ic.textContent = item.icon;
    var body = el('span', 'rt-note-body');
    var t = el('span', 'rt-note-title');
    t.textContent = item.title;
    body.appendChild(t);
    if (item.text) {
      var x = el('span', 'rt-note-text');
      x.textContent = item.text;
      body.appendChild(x);
    }
    row.appendChild(ic);
    row.appendChild(body);
    if (item.run) row.addEventListener('click', item.run);
    return row;
  }

  function refreshShade() {
    if (!ui.shade) return;
    var items = shadeItems();
    ui.shadeDate.textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    ui.shadeBody.textContent = '';
    function section(title, list) {
      if (!list.length) return;
      var h = el('h3', 'rt-shade-section');
      h.textContent = title;
      ui.shadeBody.appendChild(h);
      list.forEach(function (i) { ui.shadeBody.appendChild(shadeRow(i)); });
    }
    section('Ongoing', items.ongoing);
    section('Notifications', items.notes);
    if (!items.ongoing.length && !items.notes.length) {
      var none = el('p', 'rt-shade-none');
      none.textContent = 'No notifications';
      ui.shadeBody.appendChild(none);
    }
    ui.shadeClear.hidden = !items.notes.length;
    // The status bar's notification icons: one per unread notification (up to 4).
    if (ui.statusNotes) {
      ui.statusNotes.textContent = '';
      items.notes.slice(0, 4).forEach(function (n) {
        var i = el('span', 'rt-status-note');
        i.textContent = n.icon;
        ui.statusNotes.appendChild(i);
      });
      ui.status.setAttribute('data-unread', String(items.notes.length));
      ui.status.setAttribute('aria-label', (items.notes.length ? items.notes.length + ' notifications. ' : 'No notifications. ') + 'Pull down or tap to open');
    }
  }

  function shadeOpen() { return ui.shade && ui.shade.classList.contains('rt-open'); }
  function openShade() {
    if (shadeOpen()) return;
    history.pushState({ rt: 'shade' }, '');
    showShade(true);
  }
  function closeShade() {
    if (!shadeOpen()) return;
    if (history.state && history.state.rt === 'shade') history.back();
    else showShade(false);
  }
  function showShade(on) {
    refreshShade();
    ui.shade.classList.toggle('rt-open', on);
    ui.shade.setAttribute('aria-hidden', on ? 'false' : 'true');
    ui.status.setAttribute('aria-expanded', on ? 'true' : 'false');
    ui.pages.inert = on || drawerOpen();
    ui.dock.inert = on || drawerOpen();
    if (nav.refreshBack) nav.refreshBack();
    wallpaperPaused(on);
    if (on) (ui.shadeBody.querySelector('a, button') || ui.shadeClear).focus({ preventScroll: true });
    else if (ui.shade.contains(document.activeElement)) ui.status.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------ live wallpaper */

  // Slow glowing motes drifting upwards, tinted rust and lime; a gentle
  // parallax as the home screens swipe. Paused when hidden or covered,
  // capped near 30 fps, and a single still frame with reduced motion or
  // when "Wallpaper motion" is off.
  var wall = { raf: 0, last: 0, motes: [], paused: false };

  function buildWallpaper() {
    ui.wall = el('canvas', 'rt-wallpaper', { 'aria-hidden': 'true' });
    wall.ctx = ui.wall.getContext('2d');
    var n = 42;
    wall.motes = [];
    for (var i = 0; i < n; i++) {
      wall.motes.push({
        x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7,
        r: 0.6 + Math.random() * 1.8, tint: Math.random() < 0.55 ? 0 : (Math.random() < 0.6 ? 1 : 2),
        tw: Math.random() * Math.PI * 2
      });
    }
  }

  function sizeWallpaper() {
    if (!ui.wall) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = root.getBoundingClientRect();
    ui.wall.width = Math.max(1, Math.round(r.width * dpr));
    ui.wall.height = Math.max(1, Math.round(r.height * dpr));
    wall.dpr = dpr;
    drawWallpaper(0);
  }

  function moving() {
    return setting('motion') && !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !document.hidden && !wall.paused && mounted;
  }
  function wallpaperPaused(on) { wall.paused = on || drawerOpen() || shadeOpen(); tickControl(); }
  function tickControl() {
    cancelAnimationFrame(wall.raf);
    wall.raf = 0;
    if (!ui.wall) return;
    ui.wall.setAttribute('data-moving', moving() ? 'true' : 'false');
    if (moving()) wall.raf = requestAnimationFrame(tick);
    else drawWallpaper(0);
  }
  function tick(t) {
    wall.raf = requestAnimationFrame(tick);
    if (t - wall.last < 33) return; // ~30 fps
    var dt = Math.min(0.1, (t - (wall.last || t)) / 1000);
    wall.last = t;
    drawWallpaper(dt);
  }

  function drawWallpaper(dt) {
    var c = wall.ctx;
    if (!c) return;
    var w = ui.wall.width, h = ui.wall.height, dpr = wall.dpr || 1;
    var light = matchMedia('(prefers-color-scheme: light)').matches;
    c.clearRect(0, 0, w, h);
    var parallax = ui.pages ? ui.pages.scrollLeft / Math.max(1, ui.pages.clientWidth) : CENTRE;
    var tints = light
      ? ['rgba(90,110,80,', 'rgba(120,150,40,', 'rgba(179,84,46,']
      : ['rgba(235,230,220,', 'rgba(159,208,29,', 'rgba(224,133,84,'];
    wall.motes.forEach(function (m) {
      m.y -= dt * 0.012 * m.z;
      m.tw += dt * 1.3;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      var x = ((m.x - parallax * 0.06 * m.z) % 1 + 1) % 1 * w;
      var y = m.y * h;
      var r = m.r * dpr * (0.8 + m.z);
      var a = (light ? 0.28 : 0.55) * (0.55 + 0.45 * Math.sin(m.tw)) * m.z;
      var g = c.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, tints[m.tint] + a.toFixed(3) + ')');
      g.addColorStop(1, tints[m.tint] + '0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r * 4, 0, Math.PI * 2);
      c.fill();
    });
  }

  /* ------------------------------------------------- icon context menu */

  // Long-press an icon (or right-click it) for Gingerbread's context menu.
  // A long-press never also opens the idea.
  var press = { timer: 0, x: 0, y: 0, icon: null, swallow: false };
  function iconAt(target) { return target && target.closest ? target.closest('#retro .rt-icon') : null; }
  function cancelPress() {
    clearTimeout(press.timer);
    if (press.icon) press.icon.classList.remove('rt-pressed');
    press.icon = null;
  }
  root.addEventListener('pointerdown', function (e) {
    // Every new press starts clean (a menu opened by the last one took its
    // release, so nothing reset this).
    press.swallow = false;
    var ic = iconAt(e.target);
    if (!ic || e.button > 0) return;
    cancelPress();
    press.icon = ic;
    press.x = e.clientX;
    press.y = e.clientY;
    press.timer = setTimeout(function () {
      var target = press.icon;
      cancelPress();
      press.swallow = true; // the click that ends this press
      if (target) iconMenu(target.getAttribute('data-slug'));
    }, 500);
  });
  root.addEventListener('pointermove', function (e) {
    if (press.icon && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 12) cancelPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { root.addEventListener(t, cancelPress); });
  root.addEventListener('contextmenu', function (e) {
    var ic = iconAt(e.target);
    if (!ic) return;
    e.preventDefault();
    // Android fires contextmenu for the same long-press the timer already
    // answered: one menu per press.
    if (press.swallow) return;
    cancelPress();
    iconMenu(ic.getAttribute('data-slug'));
  });
  // Swallow the click that ends a long-press, however long it was held.
  root.addEventListener('click', function (e) {
    if (press.swallow && iconAt(e.target)) { e.preventDefault(); e.stopPropagation(); }
    press.swallow = false;
  }, true);

  function iconMenu(slug) {
    nav.feedback('long');
    var idea = ideas.filter(function (i) { return i.slug === slug; })[0];
    if (!idea) return;
    var inDock = dockSlugs().indexOf(slug) !== -1;
    var status = idea.saveable === false ? Promise.resolve(null) : nav.offlineStatus().catch(function () { return null; });
    status.then(function (st) {
      var saved = !!(st && st.saved.indexOf(slug) !== -1);
      nav.menu(idea.title, [
        { id: 'open', label: 'Open', run: function () { location.href = new URL(idea.url, location.href).href; } },
        inDock
          ? { id: 'dock', label: 'Remove from dock', run: function () { setDock(dockSlugs().filter(function (s) { return s !== slug; })); } }
          : { id: 'dock', label: 'Add to dock', run: function () { addToDock(slug); } },
        idea.saveable === false || !st ? null : saved
          ? { id: 'save', label: 'Saved ✓ (tap to unsave)', run: function () { save(idea, false); } }
          : { id: 'save', label: 'Save offline', run: function () { save(idea, true); } },
        { id: 'share', label: 'Share', run: function () { nav.share(idea); } },
        { id: 'about', label: 'About this idea', run: function () { nav.aboutIdea(idea); } }
      ], { idea: idea });
    });
  }

  function setDock(slugs) {
    lset(KEY.dock, slugs.slice(0, 2));
    if (ui.slot) fillDock();
  }
  // Adding to a full dock replaces the older of the two.
  function addToDock(slug) {
    var cur = dockSlugs().filter(function (s) { return s !== slug; });
    if (cur.length >= 2) cur = cur.slice(1);
    cur.push(slug);
    setDock(cur);
    nav.toast('Added to dock');
  }

  function save(idea, on) {
    nav.toast(on ? 'Saving ' + idea.title + '…' : 'Removing…', 0);
    nav.saveOffline(idea.slug, on).then(function () {
      nav.toast(on ? 'Saved for offline' : 'No longer saved');
    }, function () { nav.toast("Couldn't reach offline storage"); });
  }

  /* ------------------------------------------------------------ launch */

  // Tapping an icon zooms its tile up to fill the screen, then opens the
  // idea; if the idea is slow to arrive, a "Loading…" card appears. With
  // reduced motion it's a plain, instant switch.
  var LAUNCHABLE = 'a.rt-icon';
  root.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest(LAUNCHABLE);
    if (!a || !root.contains(a) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    launch(a);
  });

  function launch(a) {
    var href = a.href;
    var tile = a.querySelector('.rt-tile');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !tile || !tile.animate) { location.href = href; return; }
    nav.feedback('key');
    var r = tile.getBoundingClientRect();
    var z = el('div', 'rt-zoom', { 'aria-hidden': 'true' });
    z.style.left = r.left + 'px';
    z.style.top = r.top + 'px';
    z.style.width = r.width + 'px';
    z.style.height = r.height + 'px';
    z.style.background = getComputedStyle(tile).backgroundImage;
    z.textContent = tile.textContent;
    root.appendChild(z);
    var anim = z.animate([
      { transform: 'none', borderRadius: '13px', fontSize: '30px' },
      { transform: 'translate(' + -r.left + 'px,' + -r.top + 'px) scale(' + window.innerWidth / r.width + ',' + window.innerHeight / r.height + ')',
        borderRadius: '0px', fontSize: '0px' }
    ], { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' });
    var go = function () {
      location.href = href;
      // Still here after a moment? The idea is on its way: say so.
      setTimeout(function () {
        if (!z.isConnected) return;
        var card = el('div', 'rt-loading', { role: 'status' });
        var label = a.querySelector('.rt-label');
        card.innerHTML = '<span class="rt-spinner" aria-hidden="true"></span><span></span>';
        card.lastChild.textContent = 'Loading ' + (label ? label.textContent : '') + '…';
        root.appendChild(card);
      }, 600);
    };
    anim.onfinish = go;
    anim.oncancel = go;
  }

  /* -------------------------------------------------------------- boot */

  // A cold start of the installed app (the first page of a new session)
  // plays a short boot animation: the "r" drawing itself in rust light,
  // then "random". A tap skips it. Never on in-app navigation, never in
  // modern, a plain fade with reduced motion.
  var BOOTED = 'random-hub:booted';
  function installed() {
    try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
  }
  function boot() {
    var seen = true;
    try { seen = sessionStorage.getItem(BOOTED) === '1'; sessionStorage.setItem(BOOTED, '1'); } catch (e) {}
    if (seen || !installed()) return;
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var b = el('div', 'rt-boot' + (still ? ' rt-boot-still' : ''), { role: 'img', 'aria-label': 'random is starting' });
    b.innerHTML =
      '<svg viewBox="0 0 512 512" aria-hidden="true"><g transform="translate(256 256) scale(1.3) translate(-256 -262)" fill="none" stroke-width="46" stroke-linecap="round">' +
      '<path class="rt-boot-stem" pathLength="1" d="M204 186V342"/><path class="rt-boot-arm" pathLength="1" d="M204 262C206 214 246 186 310 190"/></g></svg>' +
      '<span class="rt-boot-word">random</span>';
    document.body.appendChild(b);
    document.documentElement.setAttribute('data-booting', '');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      b.classList.add('rt-boot-out');
      document.documentElement.removeAttribute('data-booting');
      nav.feedback('unlock');
      setTimeout(function () { b.remove(); }, 320);
    }
    b.addEventListener('click', finish);
    setTimeout(finish, still ? 400 : 1500);
  }

  /* ---------------------------------------------------------- settings */

  // The in-hub Settings app, Gingerbread list style. A history entry, like
  // the drawer: Back closes it.
  function settingsOpen() { return ui.settings && ui.settings.classList.contains('rt-open'); }
  var pendingSettings = null;

  function openSettings(section) {
    if (!mounted || !ui.drawer) { pendingSettings = section || 'top'; return; }
    if (!settingsOpen()) {
      history.pushState({ rt: 'settings' }, '');
      showSettings(true);
    }
    var target = section && ui.settings.querySelector('[data-section="' + section + '"]');
    if (target) target.scrollIntoView({ block: 'start' });
  }
  function closeSettings() {
    if (!settingsOpen()) return;
    if (history.state && history.state.rt === 'settings') history.back();
    else showSettings(false);
  }

  function buildSettings() {
    ui.settings = el('div', 'rt-settings', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings', 'aria-hidden': 'true' });
    var head = el('div', 'rt-settings-head');
    var h = el('h2');
    h.textContent = 'Settings';
    head.appendChild(h);
    ui.settingsBody = el('div', 'rt-settings-body');
    ui.settings.appendChild(head);
    ui.settings.appendChild(ui.settingsBody);
    ui.settings.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closeSettings(); } });
  }

  function showSettings(on) {
    if (on) renderSettings();
    ui.settings.classList.toggle('rt-open', on);
    ui.settings.setAttribute('aria-hidden', on ? 'false' : 'true');
    ui.pages.inert = on || drawerOpen() || shadeOpen();
    ui.dock.inert = on || drawerOpen() || shadeOpen();
    if (nav.refreshBack) nav.refreshBack();
    wallpaperPaused(on);
    if (on) { var first = ui.settingsBody.querySelector('button, a'); if (first) first.focus({ preventScroll: true }); }
  }

  function sectionHead(title, id) {
    var h3 = el('h3', 'rt-set-section', { 'data-section': id });
    h3.textContent = title;
    ui.settingsBody.appendChild(h3);
  }
  // A row: title, summary, and a checkbox (switch) or nothing (an action).
  function row(o) {
    var tag = o.href ? 'a' : 'button';
    var r = el(tag, 'rt-set-row', o.href ? { href: o.href, 'data-row': o.id, target: '_blank', rel: 'noopener' } : { type: 'button', 'data-row': o.id });
    if (o.checked != null) { r.setAttribute('role', 'switch'); r.setAttribute('aria-checked', o.checked ? 'true' : 'false'); }
    var text = el('span', 'rt-set-text');
    var t = el('span', 'rt-set-title');
    t.textContent = o.title;
    text.appendChild(t);
    if (o.summary != null) {
      var sm = el('span', 'rt-set-summary');
      sm.textContent = o.summary;
      text.appendChild(sm);
      r._summary = sm;
    }
    r.appendChild(text);
    if (o.checked != null) r.appendChild(el('span', 'rt-check', { 'aria-hidden': 'true' }));
    if (o.run) r.addEventListener('click', function () { o.run(r); });
    ui.settingsBody.appendChild(r);
    return r;
  }
  function toggleRow(id, title, name, on, off) {
    return row({ id: id, title: title, summary: setting(name) ? on : off, checked: setting(name), run: function (r) {
      var v = !setting(name);
      setSetting(name, v);
      r.setAttribute('aria-checked', v ? 'true' : 'false');
      r._summary.textContent = v ? on : off;
    } });
  }

  function renderSettings() {
    var body = ui.settingsBody;
    var top = body.scrollTop;
    body.textContent = '';

    sectionHead('Display', 'display');
    row({ id: 'look', title: 'Retro look', summary: 'The Gingerbread launcher. Turn off for the modern card grid.', checked: true,
      run: function () { nav.setLook('modern'); } });
    toggleRow('motion', 'Wallpaper motion', 'motion', 'The live wallpaper drifts', 'The wallpaper stays still');
    row({ id: 'clock', title: 'Clock style', summary: clockStyle() === 'analog' ? 'Analog' : 'Digital', run: function (r) {
      lset(KEY.clock, clockStyle() === 'analog' ? 'digital' : 'analog');
      paintClock();
      r._summary.textContent = clockStyle() === 'analog' ? 'Analog' : 'Digital';
    } });

    sectionHead('Sound & feedback', 'feedback');
    toggleRow('sounds', 'UI sounds', 'sounds', 'Clicks and chimes', 'Silent');
    toggleRow('haptics', 'Haptic feedback', 'haptics', 'A tick on key presses (Android)', 'No vibration');

    sectionHead('Home screen', 'home');
    row({ id: 'reset-dock', title: 'Reset dock', summary: 'Back to your two most recent ideas', run: function () {
      try { localStorage.removeItem(KEY.dock); } catch (e) {}
      fillDock();
      nav.toast('Dock reset');
    } });

    sectionHead('Storage', 'storage');
    var used = row({ id: 'usage', title: 'Space used', summary: 'Measuring…' });
    used.disabled = true;
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (e) {
        var mb = function (b) { return (b / 1048576).toFixed(1) + ' MB'; };
        used._summary.textContent = mb(e.usage || 0) + (e.quota ? ' of ' + mb(e.quota) + ' available' : '');
      }, function () { used._summary.textContent = 'Unavailable'; });
    } else used._summary.textContent = 'Unavailable';
    var savedHolder = el('div', 'rt-set-group', { 'data-group': 'saved' });
    body.appendChild(savedHolder);
    nav.offlineStatus().then(function (st) {
      savedHolder.textContent = '';
      var saved = ideas.filter(function (i) { return st.saved.indexOf(i.slug) !== -1; });
      if (!saved.length) {
        var none = el('p', 'rt-set-none');
        none.textContent = 'No ideas saved for offline. Long-press an icon to save one.';
        savedHolder.appendChild(none);
      }
      saved.forEach(function (idea) {
        var r = row({ id: 'saved:' + idea.slug, title: idea.title, summary: 'Saved for offline', checked: true, run: function (rr) {
          rr.disabled = true;
          nav.saveOffline(idea.slug, false).then(function () { renderSettings(); });
        } });
        savedHolder.appendChild(r); // row() appended to body; move it into the group
      });
    }, function () { savedHolder.textContent = ''; });
    row({ id: 'clear-cache', title: 'Clear cached ideas', summary: 'Frees space; ideas saved for offline stay', run: function (r) {
      r.disabled = true;
      nav.clearCached().then(function () { nav.toast('Cached ideas cleared'); renderSettings(); },
        function () { nav.toast("Couldn't reach offline storage"); r.disabled = false; });
    } });

    sectionHead('About', 'about');
    var ver = row({ id: 'version', title: 'Version', summary: '…' });
    ver.disabled = true;
    nav.offlineStatus().then(function (st) { ver._summary.textContent = st.version || 'unknown'; }, function () { ver._summary.textContent = 'unknown'; });
    var count = row({ id: 'ideas', title: 'Ideas', summary: ideas.length + ' small ideas, each one a tiny page' });
    count.disabled = true;
    row({ id: 'source', title: 'Source', summary: 'github.com/rickymetz/random', href: 'https://github.com/rickymetz/random' });
    row({ id: 'licences', title: 'Licences', summary: 'Droid Sans © The Android Open Source Project, Apache 2.0',
      href: new URL('fonts/LICENSE-DroidSans.txt', location.href).href });
    body.scrollTop = top;
  }

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
    boot();
    paintSystemBar(true);
    nav.ideas().then(function (list) {
      if (!mounted) return;
      ideas = (list || []).slice();
      root.textContent = '';
      buildWallpaper();
      buildStatusBar();
      buildPages();
      buildDock();
      buildDrawer();
      buildShade();
      buildSettings();
      root.appendChild(ui.wall);
      root.appendChild(ui.status);
      root.appendChild(ui.pages);
      root.appendChild(ui.dots);
      root.appendChild(ui.dock);
      root.appendChild(ui.drawer);
      root.appendChild(ui.settings);
      root.appendChild(ui.shade);
      // Open on the centre screen, after layout gives the pages a width.
      requestAnimationFrame(function () {
        if (!mounted || !ui.pages) return;
        goTo(CENTRE, false);
        sizeWallpaper();
        tickControl();
      });
      var state = history.state && history.state.rt;
      if (state === 'drawer') showDrawer(true);
      if (state === 'shade') showShade(true);
      if (state === 'settings') showSettings(true);
      // An idea page's ≡ → Settings arrives as #settings.
      if (location.hash === '#settings') {
        history.replaceState(history.state, '', location.pathname + location.search);
        pendingSettings = pendingSettings || 'top';
      }
      if (pendingSettings) { var sec = pendingSettings; pendingSettings = null; openSettings(sec === 'top' ? null : sec); }
      // Clocks tick on the minute; the shade's live items follow events.
      paintStatusClock();
      clockTimer = setInterval(function () { paintStatusClock(); paintClock(); }, 15000);
      root.setAttribute('data-ready', '');
    });
  }

  // keepLayers: a back/forward-cache redraw keeps the drawer, shade or
  // Settings open; a switch to modern closes them for good.
  function unmount(keepLayers) {
    if (!mounted) return;
    mounted = false;
    if (!keepLayers && history.state && history.state.rt) history.replaceState(null, '');
    root.hidden = true;
    root.removeAttribute('data-ready');
    clearInterval(clockTimer);
    clearTimeout(scrollTimer);
    cancelAnimationFrame(wall.raf);
    root.textContent = '';
    ui = {};
    paintSystemBar(false);
  }

  function onLook() {
    if (nav.look() === 'retro') mount();
    else unmount();
  }
  window.addEventListener('randomlook', onLook);
  window.addEventListener('randomupdate', function () { refreshShade(); });
  window.addEventListener('randomevent', function () { refreshShade(); });
  window.addEventListener('randomsettings', function () { openSettings(); });
  // Settings and the power widget show the same switches.
  window.addEventListener('randomsetting', function (e) {
    if (!ui.grid || !e.detail) return;
    var key = root.querySelector('.rt-power-key[data-power="' + e.detail.name + '"]');
    if (key) key.setAttribute('aria-pressed', e.detail.on ? 'true' : 'false');
  });
  // ≡ → Search: to the centre screen, into the search box.
  window.addEventListener('randomsearch', function () {
    if (!mounted || !ui.search) return;
    goTo(CENTRE, false);
    ui.search.focus();
  });
  window.addEventListener('online', function () { paintNet(); refreshShade(); });
  window.addEventListener('offline', function () { paintNet(); refreshShade(); });
  window.addEventListener('resize', sizeWallpaper);
  document.addEventListener('visibilitychange', tickControl);
  window.addEventListener('randomsetting', function (e) { if (e.detail && e.detail.name === 'motion') tickControl(); });
  // Back from an idea can restore this page from the back/forward cache:
  // redraw, so New dots, the dock and the widgets reflect the visit.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && mounted) { unmount(true); mount(); }
  });
  onLook();

  // For the rest of the launcher (stage 3's menus, stage 4's Settings).
  window.randomRetro = {
    notify: notify,
    setting: setting,
    setSetting: setSetting,
    openSettings: openSettings
  };
})();
