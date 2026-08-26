# Public Domain Movies

A Plex-style browser over the ~980 films catalogued at
[publicdomaintorrents.info](https://www.publicdomaintorrents.info/nshowcat.html?category=ALL).

The page is static: it reads `data.json` and does all searching, filtering and
sorting in the browser. Nothing is fetched from the source site at view time —
that site sends no CORS headers, so a browser can't read it directly anyway.

## What you can filter and sort by

| Field   | Where it comes from                                  |
| ------- | ---------------------------------------------------- |
| Title   | the catalogue                                        |
| Genre   | the catalogue's 14 category pages                    |
| Format  | the format icons on each catalogue row               |
| Rating  | the star images on each film's detail page           |
| Year    | Wikidata / TheTVDB — **the source site has no years** |

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

The run takes about 40 minutes, almost all of it waiting: requests are
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
alone**, biased toward the earliest plausible film, since this catalogue is
almost entirely pre-1980. That mostly works, but it will sometimes attach the
wrong film's poster or year — a remake, or an unrelated modern film sharing a
title.

`build-data.mjs` writes every miss and ambiguous match to `mismatches.log`
(gitignored) so they can be reviewed. The page says as much in its footer
rather than presenting the metadata as authoritative.

## What this page deliberately does not do

- **No synopses.** The source site's plot summaries aren't ours to republish.
- **No torrent links.** Cards link to the film's page on the source site;
  downloads stay there.
- **No hotlinked screenshots** from the source site's server.
