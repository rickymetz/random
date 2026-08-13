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
- Link back to the hub with `<a href="../../">← random</a>` if you like
  (see `ideas/breathe/` for the pattern).
- Use relative URLs only; the site is served under `/random/`, so absolute
  paths like `/foo.png` will break.

## How it works

- `scripts/build.js` (plain Node, zero dependencies) copies each
  `ideas/<slug>/` folder into `_site/` and generates the homepage.
- `.github/workflows/pages.yml` builds and pushes `_site/` to the
  `gh-pages` branch on every push to `main`; GitHub Pages serves that
  branch.
- `.github/workflows/pr-preview.yml` builds every pull request into
  `pr-preview/pr-<number>/` on the same branch and comments the live
  preview URL on the PR. The preview is deleted when the PR closes.
- Preview locally with `node scripts/build.js && npx serve _site` (or just
  open an idea's `index.html` directly in a browser).

## One-time setup

In the repo settings on GitHub: **Settings → Pages → Source → Deploy from
a branch**, branch `gh-pages`, folder `/ (root)`. After that, every push
to `main` deploys the site and every PR gets a live preview.
