# Public Screening

A Plex-style browser over the ~980 films catalogued at
[publicdomaintorrents.info](https://www.publicdomaintorrents.info/nshowcat.html?category=ALL).

The page is static: it reads `data.json` and does all searching, filtering and
sorting in the browser. Nothing is fetched from the source site at view time —
that site sends no CORS headers, so a browser can't read it directly anyway.

## What you can filter and sort by

| Field  | Where it comes from                                   |
| ------ | ----------------------------------------------------- |
| Title  | the catalogue                                         |
| Genre  | the catalogue's 14 category pages                     |
| Format | the format icons on each catalogue row                |
| Rating | the star images on each film's detail page            |
| Year   | Wikidata / TheTVDB — **the source site has no years** |

Ratings come from IMDb's public data export, matched on the IMDb ID Wikidata
holds for each film — 515 of 981. The catalogue's own star covers 481 films but
is a weak signal: three quarters of them sit at four or five stars.

The two scales are never merged. Doubling a five-star into 10/10 put 102 films
at a value no film on IMDb actually reaches, floating them above everything
genuinely well regarded. So a ten-point rating shows as a number, a site star
shows as stars, and the sort ranks real ratings above stars above nothing. The
rating filter offers "Rated", "Site stars only" and "Unrated" rather than
silently dropping films. A "Has poster" checkbox narrows to films with real
artwork, and a Random sort order shuffles the grid.

## Sharing a view

Filters, search, sort and the open film are all kept in the URL hash, so any
view can be copied out of the address bar and reopened exactly. The browser's
back button steps through filter changes and closes an open film. On a bare
visit with no hash, the last-used filters come back from `localStorage`.

The Random sort carries its seed in the URL, so a shared random order
reproduces instead of reshuffling for the next reader.

Poster art comes from fanart.tv, then TheTVDB, then a Wikimedia Commons image
via Wikidata. Anything still without art gets a poster drawn in CSS from a hash
of its title, so every card looks deliberate.

## Refreshing the data

`build-data.mjs` is an author-time script. It is **not** part of CI — the hub
workflow only runs `scripts/build.js`, and this scraper must never run on push.

```sh
cp ideas/pd-movies/.env.example ideas/pd-movies/.env   # then fill in the keys
node ideas/pd-movies/build-data.mjs --cache /tmp/pdt
```

Keys are optional. Without them you still get titles, genres, formats, ratings
and Wikidata years and art — you just lose the fanart.tv and TheTVDB posters.
`.env` is gitignored and no key is ever written into `data.json`.

The run takes roughly half an hour, almost all of it waiting: requests are
sequential with a 1.5s delay and an identifying User-Agent, because ~1000 page
views is a lot to ask of a small site. **Every response is cached to the
`--cache` directory**, so a re-run costs nothing and a crash loses nothing.
Delete that directory to force a genuinely fresh scrape.

Phases can run separately — useful because the first is slow and key-free while
the second needs the API keys:

```sh
node ideas/pd-movies/build-data.mjs --only pdt --cache /tmp/pdt   # scrape the site
node ideas/pd-movies/build-data.mjs --only art --cache /tmp/pdt   # add years + posters
```

## Known limitation: title-only matching

The source site gives no year, no IMDb id, and no other identifier — only a
title. So years and posters are matched to Wikidata and TheTVDB **by title
alone**. Two rules keep that honest:

- A candidate must match the title exactly once case, spacing and punctuation
  are normalised. Without this the databases' fuzzy search quietly returns
  some *other* film, which looks identical to a real hit.
- Candidates dated after 1990 are rejected outright. The catalogue's newest
  genuine entries are cheap late-80s pictures, so a newer match means the
  real film isn't in the database and we've landed on a modern namesake.
  Those titles get no year and a drawn poster instead of a wrong one.

It still won't be perfect — a same-era remake can pass both rules.

`build-data.mjs` writes every miss and ambiguous match to `mismatches.log`
(gitignored) so they can be reviewed. The page says as much in its footer
rather than presenting the metadata as authoritative.

## What this page deliberately does not do

- **No synopses.** The source site's plot summaries aren't ours to republish.
- **No torrent links.** Cards link to the film's page on the source site;
  downloads stay there.
- **No hotlinked screenshots** from the source site's server.
