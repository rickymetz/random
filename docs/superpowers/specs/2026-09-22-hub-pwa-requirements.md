# Hub PWA — requirements

Make the `random` hub (https://rickymetz.github.io/random/) installable as a
Progressive Web App: a home-screen launcher that opens full-screen, keeps
working offline, and gives every idea an Android-style bottom navbar so the
installed app never dead-ends. The answers below come from a requirements
interview held on 2026-09-22 and 2026-09-23 (a follow-up round settled
every open question).

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
| 14 | Navbar on the hub homepage | Yes. Home is disabled there, and Back is hidden when there's no history. |
| 15 | Runtime cache cap | About 50 MB, evicting the least recently used ideas first. |
| 16 | iOS app badge | An opt-in "Badge new ideas" toggle. Only tapping it asks for notification permission, and no pushes are ever sent. |
| 17 | Recents kept | 8 |
| 18 | Ideas with their own bottom UI | Push their UI up by a `--random-nav-h` CSS variable, so both bars stack. |
| 19 | Navbar style | Classic Android 3-button ◀ ● ■ on a thin translucent bar that follows light and dark mode. |
| 20 | Back with no history | Go to the hub, never out of the app. |
| 21 | Offline page | "You're offline", cards for the cached ideas, and a Retry button. |
| 22 | Existing "← random" links | Hide them while the navbar is present. |
| 23 | "New" label lifetime | Stays until that idea is opened. |
| 24 | Manifest shortcuts | The 4 newest ideas. |
| 25 | README | Update "Adding an idea" with the PWA conventions. |

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
  stale-while-revalidate for sub-resources. Cap the cache at **~50 MB**,
  evicting the least recently used ideas first, so the heavy ideas
  (container-compound, pd-movies, ephemera share pages) can't swell it
  without bound.
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
  shadow root (so idea CSS can't leak in either direction), styled as the
  **classic Android 3-button bar**: ◀ ● ■ glyphs on a thin translucent
  bar (backdrop blur) that follows `prefers-color-scheme`.
  - **Back (◀)**: `history.back()` when there is in-app history
    (`history.length > 1` and a same-origin `document.referrer`, or a
    `sessionStorage` breadcrumb). Otherwise it goes to the hub, never out
    of the app.
  - **Home (●)**: goes to the hub (`/random/`).
  - **Recents (■)**: opens the recent ideas tray (R5).
- Shown **always**: in browser tabs and in the installed app, **including
  the hub homepage**. There Home is shown disabled, and Back is hidden
  when there's no history.
- Respects `env(safe-area-inset-bottom)`, supports light and dark mode
  through `prefers-color-scheme`, has touch targets of 48px or more,
  `aria-label`s, and is keyboard reachable.
- Reserves space so it doesn't cover content, via
  `body { padding-bottom: <bar height> }` applied from the script.
- Sets `--random-nav-h` on `<html>` (bar height plus the safe-area inset,
  `0px` when the bar is absent). **Ideas with their own bottom UI offset
  it by that variable**, so both bars are visible and stack, for example
  `bottom: var(--random-nav-h, 0px)`. Ideas that need this:
  - Cadence: `.tabbar`
  - Container Compound: the add-button FAB and bottom sheet
  - Ephemera and Public Screening: the bottom drawers and scrim
  - Ledger (`dossier/app`): its bottom UI, to be checked during
    implementation
- Opt-outs: `<meta name="random-nav" content="off">` hides the bar, and
  `content="overlay"` skips the body padding.
- **Existing back links**: while the bar is present, `nav.js` adds
  `random-nav` to `<html>` and hides the idea's own hub links. Those are
  same-page `<a>` elements whose resolved `href` is the hub root and whose
  text starts with "←", such as Breathe's fixed `a.back`. An idea keeps
  such a link with `data-random-keep`. If the bar fails to load the links
  still work, so they are the fallback.
- Idempotent: loading twice (injected *and* script-tagged) renders one bar.

### R5. Recent ideas tray

- `nav.js` records `{slug, title, visitedAt}` in `localStorage`
  (`random-hub:recents`) on each idea page load, keeps the **8** most recent,
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
- **Baseline**: on the first-ever visit the hub stores
  `random-hub:since` (an ISO date). Ideas dated on or before it are never
  "new", so a first visit shows no labels.
- **Card label**: an idea dated after `since` that hasn't been opened
  gets a small "New" pill. The pill **stays until that idea is opened**.
  `nav.js` adds the slug to `random-hub:opened` on each idea page load.
- **App icon badge**: the count is the number of ideas that are new and
  unopened. `navigator.setAppBadge(count)` is called when the hub runs,
  when the worker updates and when an idea is opened, and
  `clearAppBadge()` is called at 0. It's feature-detected and a silent
  no-op where unsupported. There's no push or periodic sync.
- **iOS**: Safari only honours the badge after notification permission is
  granted. The hub shows an opt-in **"Badge new ideas"** toggle only when
  running standalone on iOS with permission not yet decided. Only tapping
  it calls `Notification.requestPermission()`, and nothing ever sends a
  notification. Android and desktop need no toggle.

### R9. Offline page

- `offline.html` is styled like the hub: "You're offline", a **Retry**
  button (reloads the requested URL), and cards for every idea that is
  available offline. It lists the ideas whose `ideas/<slug>/` navigation
  is in the runtime cache, with titles from the cached `ideas.json`.
- It's precached with the shell, and the navbar shows on it too.

### R10. Install UX

- **Chromium**: capture `beforeinstallprompt`, show an "Install" button in
  the hub header, and hide it after `appinstalled` or when already in
  `display-mode: standalone`.
- **iOS Safari (not standalone)**: a dismissible tip, "Install: tap Share →
  Add to Home Screen". The dismissal is remembered in `localStorage`.
- Neither appears in the installed app.

### R11. Build and deploy

- `build.js` writes `manifest.webmanifest`, `ideas.json` and the
  version-stamped `sw.js` (from a template such as `scripts/sw.template.js`)
  to the repo root, and mirrors them into `_site/`.
- `pages.yml` must `git add` the new generated files alongside `index.html`.
- The manifest `shortcuts` are the **4 newest** non-hidden ideas.
- There's still zero npm dependencies at the hub level.

### R12. README

- Update "Adding an idea" and "How it works" with the new conventions:
  - Every idea gets the bottom navbar automatically.
  - Offset fixed bottom UI by `var(--random-nav-h, 0px)`.
  - The `random-nav` meta opt-outs (`off`, `overlay`).
  - `data-random-keep` for a hub link that should stay visible.
  - Relative URLs matter for offline caching too.
  - An idea that ships its own service worker must add the `nav.js`
    script tag itself.

## Acceptance checks

1. Chrome Lighthouse / DevTools "Installable" passes, and Android and
   desktop Chrome offer install.
2. iOS Safari "Add to Home Screen" gives the "r" icon and opens standalone.
3. In airplane mode the hub loads, previously opened ideas load, and an
   unopened idea shows `offline.html`.
4. Every idea shows the navbar on its second visit (and first, for Cadence
   and Ledger), and so does the hub homepage. Back, Home and Recents all
   work in standalone. Back from a shortcut-launched idea lands on the hub.
   The ideas' own bottom UI sits above the bar, not under it, and the old
   "← random" links are hidden.
5. After a deploy that adds an idea, the open app shows the refresh toast,
   the new card has a "New" pill that survives reloads until the idea is
   opened, and the icon badge shows 1 (on iOS only after the toggle).
6. Cadence's and Ledger's offline behaviour and their caches are unchanged
   after the hub worker installs.
7. `node scripts/build.js` on a clean checkout produces the manifest,
   `ideas.json` and `sw.js` with no `npm install`.
8. The runtime cache stays under ~50 MB after browsing every idea, and
   the offline page lists what's left.

## Open questions

None. Every requirement question has been answered.
