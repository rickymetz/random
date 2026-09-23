# random

A hub for small ideas, published to GitHub Pages. Each idea is a tiny
self-contained static page; the homepage is generated automatically by
scanning the `ideas/` folder — no manual index upkeep, no external services.

**Live site:** https://rickymetz.github.io/random/

## Adding an idea

1. Create `ideas/<slug>/index.html` (plus any assets it needs — everything in
   the folder is deployed as-is).
2. Push to `main`. GitHub Actions rebuilds and redeploys the site, and the
   homepage picks up the new idea automatically.

That's it. A typical prompt to Claude Code is just:

> Build a tiny \<whatever\> in `ideas/<slug>/` and push.

### Optional metadata

The homepage card uses the idea's `<title>` and
`<meta name="description">` tags by default. To override (or to hide an
idea), add an `ideas/<slug>/idea.json`:

```json
{
  "title": "Breathe",
  "description": "A one-minute box-breathing circle.",
  "emoji": "🫧",
  "hidden": false
}
```

Ideas are ordered newest-first on the homepage, dated by the first commit
that touched their folder.

### Conventions

- Keep each idea fully self-contained in its folder — no shared build step,
  no dependencies. Plain HTML/CSS/JS that works when opened directly.
- Every idea gets the hub's bottom navbar (◀ Back, ● Home, ■ Recents)
  automatically, so a link home is optional. An old-style
  `<a href="../../">← random</a>` (or an icon-only link home) is hidden
  while the bar is up; add `data-random-keep` to keep one visible.
- **Bottom-anchored UI** (tab bars, FABs, bottom sheets) must sit above the
  navbar: offset it by `var(--random-nav-h, 0px)`, which the bar sets on
  `<html>` and which already includes the home-indicator inset. A handy
  pattern is `--sab: var(--random-nav-h, env(safe-area-inset-bottom))`
  (see `ideas/cadence/styles.css`).
- The bar appends a spacer to `<body>` so it never covers the end of the
  page. An idea that already pads for it (via `--random-nav-h`) opts out
  with `<meta name="random-nav" content="overlay">`; `content="off"` hides
  the bar altogether.
- Use relative URLs only; the site is served under `/random/`, so absolute
  paths like `/foo.png` will break. (Relative URLs are also what makes an
  idea work offline once it has been opened.)
- **Immersive moments** (an exercise, a slideshow) can tuck the bar away
  with `window.randomNav?.hide()` and bring it back with `.show()`; a
  handle at the bottom edge (or a swipe up) lets people bring it back
  themselves. Full screen hides it automatically.
- An idea that registers **its own service worker** is outside the hub
  worker's reach: add `<script src="../../nav.js" defer></script>` yourself,
  and don't let your worker cache files outside your folder (see
  `ideas/cadence/sw.js`).

## Installable app

The hub is a PWA: install it from the header's **Install** button (Chrome,
Edge, Android) or **Share → Add to Home Screen** (iOS). Installed, it opens
standalone, works offline for the homepage and every idea you've opened
(about 50 MB, least recently used idea evicted first), marks ideas added
since your first visit as **New** until you open them (and counts them on
the app icon), and offers each deploy as a "New ideas available" toast.
Each card has a **Save offline** button that saves the whole idea ahead
of time and keeps it from being evicted (ideas under 150 KB are saved at
install anyway). Long-press ● — or **Share** in the recents tray — to
share the idea you're on; on Android, links shared *to* the app open the
idea they point at.
The requirements live in
`docs/superpowers/specs/2026-09-22-hub-pwa-requirements.md`.

| File | Role |
| --- | --- |
| `nav.js` | The bottom navbar, recents tray, New/badge bookkeeping, update toast. Loaded on every page. |
| `hub.js` | Homepage only: Install button, iOS install hint, iOS badge opt-in. |
| `offline.html` | Served in place of an idea that isn't cached yet. |
| `scripts/sw.template.js` | The service worker. `build.js` stamps it into `sw.js`. |
| `icon*.png`, `icon.svg`, `apple-touch-icon.png` | The "r" monogram. |
| `manifest.webmanifest`, `ideas.json`, `sw.js` | **Generated** by `build.js`; don't edit. |
| `scripts/test/hub-e2e.mjs` | End-to-end checks in Chromium; run by `.github/workflows/hub-ci.yml`. |

Run the checks locally with an installed Playwright (the hub keeps no
dependency manifest, so point at one):

```sh
node scripts/build.js
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/test/hub-e2e.mjs
```

## How it works

- GitHub Pages serves the `main` branch directly (Settings → Pages →
  Deploy from a branch, `main` `/ (root)`); `.nojekyll` makes it serve
  files verbatim.
- `scripts/build.js` (plain Node, zero dependencies) generates the
  homepage at the repo root by scanning `ideas/`, along with the PWA's
  `manifest.webmanifest` (whose long-press shortcuts are the four newest
  ideas), `ideas.json` and `sw.js`, and mirrors everything into `_site/`
  as a local preview. The worker's version is a hash of everything it
  serves, so any deploy that changes the hub is offered as an update.
- `.github/workflows/pages.yml` reruns the build on every push to `main`
  and commits the regenerated files when they changed — so the
  homepage stays current with zero manual upkeep.
- Preview locally with `node scripts/build.js && npx serve _site` (or just
  open an idea's `index.html` directly in a browser).
