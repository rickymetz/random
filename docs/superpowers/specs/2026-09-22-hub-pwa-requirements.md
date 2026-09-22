# Hub PWA — requirements

Make the `random` hub (https://rickymetz.github.io/random/) installable as a
Progressive Web App: a home-screen launcher that opens full-screen, keeps
working offline, and gives every idea an Android-style bottom navbar so the
installed app never dead-ends. The answers below come from a requirements
interview held on 2026-09-22.

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Goal | Launcher plus offline support. |
| 2 | Offline scope | Precache the hub homepage. Cache each idea at runtime the first time it is opened. |
| 3 | Ideas that are already PWAs | Leave them alone. The hub worker never intercepts their scopes. |
| 4 | Display mode | `standalone` |
| 5 | Getting back to the hub | An injected **bottom navbar** with Back, Home (hub) and App switcher. |
| 6 | App switcher | A **recent ideas tray**: the ideas opened recently, tap one to jump to it. |
| 7 | Navbar mechanism | The service worker injects it into idea HTML. The PWAs it can't reach carry a one-line `<script>` instead. |
| 8 | Navbar visibility | **Always**, in the browser and in the installed app. |
| 9 | Updates | A "New ideas available — refresh" toast. Never an auto-reload. |
| 10 | New-idea signals | A "New" badge on cards **and** an app-icon badge (Badging API). |
| 11 | Icon | A lowercase "r" monogram in the rust accent `#b3542e` on warm off-white `#faf9f7`. |
| 12 | Install UX | An Install button on Chromium and a dismissible "Share → Add to Home Screen" hint on iOS Safari. |
| 13 | Build | `scripts/build.js` generates the manifest (with shortcuts) and stamps the worker's cache version. |

## Where it stands today

- The hub is a static `index.html` at the repo root. `scripts/build.js`
  (plain Node, no dependencies) generates it by scanning `ideas/`, and
  `.github/workflows/pages.yml` commits it back on each push to `main`. Pages
  serves `main` under `/random/`.
- Two apps already ship their own worker and manifest:
  - **Cadence**: `ideas/cadence/sw.js`, scope `/random/ideas/cadence/`.
    It is hand-written, and its header comment warns that CacheStorage is
    origin-wide, so no app may delete caches it doesn't own.
  - **Ledger**: built from `dossier/app/` (Vite + workbox) and deployed to
    `/random/ledger/`, scope `/random/ledger/`. `ideas/ledger/` is only a
    meta-refresh stub that points there.
- The hub itself has no manifest, no worker and no icons.

## Requirements

### R1. Manifest

- `build.js` generates `manifest.webmanifest` at the repo root:
  `name: "random"`, `short_name: "random"`, `start_url: "./"`,
  `scope: "./"`, `display: "standalone"`, `theme_color`/`background_color`
  taken from the hub's light palette, and icons at 192, 512 and 512
  `maskable`.
- `shortcuts`: the 4 newest non-hidden ideas (title, `ideas/<slug>/` URL,
  shared icon).
- The hub `<head>` gets `<link rel="manifest">`, `theme-color` metas for
  light and dark, `apple-touch-icon`, `apple-mobile-web-app-capable` and
  `apple-mobile-web-app-title`.

### R2. Icon

- An SVG source, `icon.svg`, with a lowercase "r" monogram in `#b3542e` on
  `#faf9f7`. The maskable variant keeps the glyph inside the 80% safe zone.
- PNGs (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png` 180×180) are rendered once and committed. Nothing
  renders them at build time, so there are still no dependencies.

### R3. Service worker (`/random/sw.js`, scope `/random/`)

- **Precache** the hub shell (`./`, `index.html`, manifest, icons,
  `nav.js`, offline page) with `{cache: 'reload'}`, all-or-nothing, as
  Cadence does.
- **Runtime cache** for same-origin GETs under `ideas/`: network-first for
  navigations (falling back to cache, then the offline page), and
  stale-while-revalidate for sub-resources. Cap the cache (e.g. ~50 MB or
  LRU by entry count) so the heavy ideas (container-compound, pd-movies,
  ephemera share pages) can't swell it without bound.
- **Hands off**: pass through untouched anything under `ideas/cadence/`,
  `ledger/` and `dossier/`, and any cross-origin request. (Their own
  registrations are more specific and win navigation control anyway. This
  is belt-and-braces for sub-resources.)
- **Cache hygiene**: only create and delete caches prefixed `random-hub-`.
  Never touch another app's caches.
- **Version**: `build.js` stamps a `VERSION` constant (a hash of the idea
  list plus the shell file contents) into `sw.js`, so every meaningful
  deploy produces a byte-different worker and triggers an update.
- **Navbar injection**: for HTML navigation responses under `ideas/`, the
  worker streams the body and inserts `<script src="/random/nav.js" defer>`
  before `</body>` (or appends it if there is none). Opaque, redirected or
  non-`text/html` responses pass through unchanged.

### R4. Bottom navbar (`nav.js`)

- A self-contained script that injects a fixed bottom bar in a closed
  shadow root (so idea CSS can't leak in either direction) with three
  Android-style buttons:
  - **Back**: `history.back()` when there is in-app history. Otherwise it
    navigates to the hub.
  - **Home**: goes to the hub (`/random/`).
  - **Switcher**: opens the recent ideas tray (R5).
- Shown **always**: in browser tabs and in the installed app.
- Respects `env(safe-area-inset-bottom)`, supports light and dark mode
  through `prefers-color-scheme`, has touch targets of 48px or more,
  `aria-label`s, and is keyboard reachable.
- Reserves space so it doesn't cover content, via
  `body { padding-bottom: <bar height> }` applied from the script. Ideas
  that pin their own bottom UI may need an opt-out:
  `<meta name="random-nav" content="off">` hides the bar, and
  `content="overlay"` skips the padding.
- Idempotent: loading twice (injected *and* script-tagged) renders one bar.
- Not rendered on the hub homepage itself, which gets the install button
  and toast instead. **Open question:** should the homepage also show the
  bar, so the switcher can be reached from the hub?

### R5. Recent ideas tray

- `nav.js` records `{slug, title, visitedAt}` in `localStorage`
  (`random-hub:recents`) on each idea page load, keeps the 8 most recent,
  and wraps every read and write in try/catch.
- The tray is a bottom sheet showing a horizontal card strip (emoji, title,
  relative time), newest first, and excludes the current page. It closes on
  tap outside, on Esc, or when the switcher is tapped again. Each card has
  a "clear" affordance.
- Titles and emoji come from the hub's `ideas.json` (R8) when it's
  available, falling back to `document.title`.
- `localStorage` is origin-wide, so recents are shared between the browser
  and the installed app on the same origin and device. That's acceptable.

### R6. The apps outside the hub worker's reach

- Add `<script src="../../nav.js" defer></script>` to
  `ideas/cadence/index.html`, and the equivalent absolute
  `/random/nav.js` to `dossier/app/index.html` so it lands in the built
  `/random/ledger/`.
- `nav.js` must coexist with their own update toasts and bottom UI. Check
  both visually.

### R7. Updates

- The hub page registers `sw.js`. When a new worker reaches `installed`
  while a controller exists, it shows a toast: "New ideas available —
  Refresh". Tapping it sends `SKIP_WAITING` and reloads on
  `controllerchange`. There's no auto-reload.
- `nav.js` shows the same toast on idea pages, so an update is noticed
  wherever you are.

### R8. "New" badges

- `build.js` also emits `ideas.json` (slug, title, emoji, description,
  date) alongside `index.html`. It feeds the tray, the badges and the app
  badge.
- **Card badge**: the hub stores `random-hub:lastSeen` (an ISO date) on
  each visit. Cards whose idea date is later than the previous `lastSeen`
  get a small "New" pill. A first-ever visit shows none.
- **App icon badge**: when the hub or the worker notices ideas newer than
  `lastSeen`, it calls `navigator.setAppBadge(count)`, and it clears the
  badge when the hub is opened. It's feature-detected and a silent no-op
  where unsupported. It refreshes when the app runs or the worker updates;
  there's no push or periodic sync.

### R9. Install UX

- **Chromium**: capture `beforeinstallprompt`, show an "Install" button in
  the hub header, and hide it after `appinstalled` or when already in
  `display-mode: standalone`.
- **iOS Safari (not standalone)**: a dismissible tip, "Install: tap Share →
  Add to Home Screen". The dismissal is remembered in `localStorage`.
- Neither appears in the installed app.

### R10. Build and deploy

- `build.js` writes `manifest.webmanifest`, `ideas.json` and the
  version-stamped `sw.js` (from a template such as `scripts/sw.template.js`)
  to the repo root, and mirrors them into `_site/`.
- `pages.yml` must `git add` the new generated files alongside `index.html`.
- A new `offline.html` at the root holds the hub-styled "You're offline —
  here's what's cached" page, which lists cached ideas via `caches.match`.
- There's still zero npm dependencies at the hub level.

## Acceptance checks

1. Chrome Lighthouse / DevTools "Installable" passes, and Android and
   desktop Chrome offer install.
2. iOS Safari "Add to Home Screen" gives the "r" icon and opens standalone.
3. In airplane mode the hub loads, previously opened ideas load, and an
   unopened idea shows `offline.html`.
4. Every idea shows the navbar on its second visit (and first, for Cadence
   and Ledger). Back, Home and the switcher all work in standalone.
5. After a deploy that adds an idea, the open app shows the refresh toast,
   the new card has a "New" pill, and the icon badge shows 1 (where
   supported).
6. Cadence's and Ledger's offline behaviour and their caches are unchanged
   after the hub worker installs.
7. `node scripts/build.js` on a clean checkout produces the manifest,
   `ideas.json` and `sw.js` with no `npm install`.

## Open questions

- Should the navbar also show on the hub homepage (R4)?
- What value for the runtime cache cap (R3)?
