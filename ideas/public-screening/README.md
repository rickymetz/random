# Public Screening

A Plex-style browser over 1,186 public domain films catalogued at
[publicdomaintorrents.info](https://www.publicdomaintorrents.info/nshowcat.html?category=ALL).

The page is static: it reads `data.json` and does all searching, filtering,
sorting and playback in the browser. Nothing is fetched from the source site
at view time — that site sends no CORS headers, so a browser can't read it
directly anyway.

## What you can filter, sort and search by

| Field       | Where it comes from                                       |
| ----------- | ----------------------------------------------------------- |
| Title       | the catalogue                                              |
| Genre       | the catalogue's category pages                             |
| Rating      | IMDb's public data export, matched on the IMDb ID Wikidata holds for each film (798 of 1,186); the catalogue's own star fills in where no match exists |
| Year        | Wikidata / TheTVDB — the source site has no years          |
| Director / cast | Wikidata (773 / 628 films)                              |
| Length      | Wikidata's duration claim                                  |
| Watchable   | has a verified Internet Archive playback match (564 films) |
| Has poster  | 804 films, art from fanart.tv, TheTVDB, Wikidata or the Archive |

The two rating scales are never merged. Doubling a five-star into a 10/10
would put 102 films at a value no real IMDb rating reaches, floating them
above everything genuinely well regarded. So a ten-point rating shows as a
number, a site star shows as stars, and sort ranks real ratings above stars
above nothing. The rating filter offers "Rated", "Site stars only" and
"Unrated" rather than silently dropping films.

Search covers title, director and cast in one box — searching "Buster
Keaton" finds everything he directed and everything he appeared in, without
needing to know which. Above the grid, two rails demonstrate this: **Search**
holds prefilled searches (people the catalogue holds a lot of, plus a few
titles like Tarzan and Zorro that only a title match — not a filter — could
find), and **Filters** holds combinations of the controls below it (a
decade, a genre plus playability, and so on). Both are shortcuts into states
the real controls can already reach; clicking one moves the actual control,
so the rails double as a demonstration of what the toolbar can do.

## Watching in the page

Where a title matches an Internet Archive item, a "Watch here" button opens
the Archive's own player inside the panel — nothing is copied here, the film
streams from their bandwidth, and the player loads only on request so opening
a film never fetches video you didn't ask for.

Archive items are matched by exact title and year, then checked again: the
Archive holds trailers and clips under a film's own name, so a matched item's
real running time is compared against the length the film should be, and
anything much shorter is rejected as a clip rather than the feature. That
check removed 113 of 471 title matches — a missing "Watch here" button is the
right trade against one that opens ninety seconds of trailer.

Escape can't close the panel once keyboard focus is inside the Archive's
iframe — a cross-origin document's keystrokes are invisible to the parent
page by design, not a bug here. Two presses of Shift+Tab reliably walk focus
back out to the close button (browsers handle that at the frame-chrome level,
which isn't blocked by cross-origin rules the way key events are), and a
small hint appears near the close button to say so while focus is inside the
player.

## Descriptions

The source site writes its own synopses; those aren't ours to reprint, so
summaries here (737 of 1,186 films) are the first two sentences of each
film's Wikipedia article, quoted under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) with a link
back to the source article. Ratings are used with permission from IMDb.
Full credit for every source lives on the page's **About** screen.

## Sharing a view

Filters, search, sort and the open film are all kept in the URL hash, so any
view can be copied out of the address bar and reopened exactly. The browser's
back button steps through filter changes and closes an open film. On a bare
visit with no hash, the last-used filters come back from `localStorage`.

The Random sort carries its seed in the URL, so a shared random order
reproduces instead of reshuffling for the next reader.

Anything without art gets a poster drawn in CSS from a hash of its title, so
every card still looks deliberate.

### Why "Copy link" exists

A `#film=` hash never reaches a server — a social unfurl bot fetching the
address-bar URL for an open film sees the bare page and nothing about which
film was open, on any host, hash-routed or not. The **Copy link** button in
a film's panel copies a different URL instead: `f/<id>/`, a real static path
with that film's own title, description and poster baked into its Open Graph
tags at build time. It redirects a human visitor straight into the app with
that film open; a crawler stops at the tags and never runs the redirect.

`build-share-pages.mjs` generates all 1,186 of these from `data.json` and is
**not** part of CI — rerun it by hand after any data refresh:

```sh
node ideas/public-screening/build-share-pages.mjs
```

## Refreshing the data

`build-data.mjs` is an author-time script. It is **not** part of CI — the hub
workflow only runs `scripts/build.js`, and this scraper must never run on
push.

```sh
cp ideas/public-screening/.env.example ideas/public-screening/.env   # then fill in the keys
node ideas/public-screening/build-data.mjs --cache /tmp/pdt
```

Keys are optional. Without them you still get titles, genres, ratings and
Wikidata years, art, credits and descriptions — you just lose the fanart.tv
and TheTVDB posters. `.env` is gitignored and no key is ever written into
`data.json`.

The run takes a while, almost all of it waiting: requests are sequential with
a 1.5s delay and an identifying User-Agent, because this asks a lot of a
small site. **Every response is cached to the `--cache` directory**, so a
re-run costs nothing and a crash loses nothing. Delete that directory to
force a genuinely fresh scrape.

Phases can run separately — useful because the first is slow and key-free
while the rest need external lookups:

```sh
node ideas/public-screening/build-data.mjs --only pdt --cache /tmp/pdt   # scrape the site
node ideas/public-screening/build-data.mjs --only art --cache /tmp/pdt   # everything else: years, posters,
                                                                          # ratings, Archive, credits, descriptions
```

Any single stage can also be rerun on its own against the published
`data.json`, without repeating the rest: `--only enrich` (Wikidata year/ids),
`--only ratings` (IMDb), `--only archive` (playback matches), `--only
credits` (director/cast), `--only extras` (runtime + remaining posters), or
`--only desc` (Wikipedia summaries).

Each phase refuses to overwrite good data with a bad run: if a phase fetches
nothing, or a field would lose more than 20% of its coverage, it aborts the
write instead of silently gutting `data.json`. Pass `--force` to override.

## Known limitation: title-only matching

The source site gives no year, no IMDb id, and no other identifier — only a
title. So years, posters, ratings and Archive matches are all found **by
title alone**. Two rules keep that honest:

- A candidate must match the title exactly — case, spacing and punctuation
  are normalised first. Without this, a database's fuzzy search quietly
  returns some *other* film, which looks identical to a real hit.
- Candidates dated after 1990 are rejected outright. The catalogue's newest
  genuine entries are cheap late-80s pictures, so a newer match means the
  real film isn't in the database and we've landed on a modern namesake.
  Those titles get no year and a drawn poster instead of a wrong one.

It still won't be perfect — a same-era remake can pass both rules. Every miss
and ambiguous match is written to `mismatches.log` (gitignored) for review,
and the page's footer says as much rather than presenting the metadata as
authoritative.

## What this page deliberately does not do

- **No reprinted synopses.** The source site's own plot summaries aren't ours
  to republish — the two-sentence Wikipedia excerpts are quoted, credited and
  licensed instead.
- **No torrent links.** Cards link to the film's page on the source site;
  downloads stay there.
- **No hotlinked screenshots** from the source site's server, and nothing
  from the Internet Archive is copied — it streams from their player, in an
  iframe, on request.
