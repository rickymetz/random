# Ephemera — design spec

A new idea in the `rickymetz/random` hub: a browser for Internet Archive's
Prelinger Archives collection — industrial, educational, government/military
instructional, and advertising shorts. A sibling to Public Screening
(`ideas/public-screening/`), not a feature of it: this content is explicitly
a different vibe from narrative movies, per the user's own framing when this
idea came up.

## Why this exists

During an earlier pass on expanding Public Screening's catalogue, the
Prelinger Archives collection came up as a large, genuinely public-domain
source that didn't fit — it's ephemeral film (industrial training, classroom
educational, government/military instructional, vintage advertising), not
movies. Rather than force it into Public Screening's identity, it gets its
own app.

## Scope

**Titled ephemeral films only** — **8,039 items** (8,046 search results
minus 7 `mediatype: collection` entries) of the collection's 10,467. The
remaining ~2,422 are raw, untitled home movies (ID-numbered, e.g. "Home
Movie: 011083", tagged mainly by decade and broad subject) — a different
browsing problem, explicitly out of scope for this version.

## Data pipeline

One source, not seven: everything comes from archive.org's own search and
metadata APIs. This is a real simplification relative to Public Screening,
where title-only matching against multiple third-party databases was the
source of nearly every serious bug this project has had (wrong-film matches,
rewritten years, CSS injection via unescaped URLs). Here, each item already
carries a stable Archive identifier as its own primary key — no matching,
no ambiguity.

- `services/search/v1/scrape` (cursor-paginated) pulls the whole item list
  in bulk: identifier, mediatype, title, year, date, subject, description,
  downloads, avg_rating. This is Archive's documented bulk endpoint and
  returns all 8,046 matching items; `advancedsearch.php` deep-paging is not
  needed.
- `metadata/<identifier>` fills in runtime and confirms a real video file
  exists.
- Author-time only, `build-data.mjs`, never run in CI — same convention as
  Public Screening.

**Measured coverage** across the full 8,046-item result (not a sample —
these are counts from an actual complete scrape performed during design):

| Field | Coverage |
| --- | --- |
| downloads | 8,001 / 8,039 (99%) |
| description | 7,033 (87%) |
| year or date | 4,460 (55%) |
| decade resolvable (year, date, or decade tag) | 4,940 (61%) |
| any subject tag | 4,232 (52%) |
| non-junk subject tag | 3,931 (48%) |

Seven of the 8,046 results have `mediatype: collection` rather than
`movies` — they are sub-collection entries, not films, and must be excluded,
leaving **8,039 items**.

**Year sanity guard**: 137 items resolve to a 2020s year, which for a
collection of mid-century ephemeral film means digitization/upload dates
leaking into the date field. Public Screening hit this exact bug before
(items dated 2026). Years beyond a plausible ceiling must be discarded
rather than displayed.

Filters and empty states need to say when data is missing rather than
presenting a gap as "no results" — same ethos Public Screening already uses
("titles are matched by name alone, so a few posters and years will belong
to the wrong film").

**Posters**: Archive's own per-item thumbnail (`archive.org/services/img/`)
is the only source — there's no Wikidata/TVDB/fanart.tv equivalent for this
content type, since promotional art was never made for a 1953 hygiene
filmstrip. Sampled thumbnails during design were reasonably representative
(a field-line diagram for "Electromagnetism," a ship's deck for a naval
film) — better than expected, likely because a short instructional film's
early frames are more often *of* its actual subject than a random frame from
a 90-minute feature would be.

## Categorization — curated tag chips, not invented categories

The original plan here was a hand-curated category set mapped from subject
tags, mirroring Public Screening's `GENRE_LABELS`. **Measurement during
design killed that approach**, and the numbers are worth recording so it
isn't re-attempted:

- Mapping real tags into 7 curated categories covers **23%** of the
  catalogue. "need keyword" is the second most common tag in the entire
  collection (225 items), ahead of every real topic but one.
- Adding title + description keyword matching raises coverage to **52%**
  but is demonstrably wrong. Spot-checked false positives: *Beef Rings the
  Bell* (a cattle-industry film) matched advertising + educational +
  government + industrial; a school-integration documentary matched
  industrial + travel. 209 items matched 4+ categories, which is incidental
  description vocabulary, not genuinely multi-topic film.

Given this project's history with confident-but-wrong inference (genre QIDs
written from memory, eight of twenty wrong; a modern *Saw* sequel matched to
a 1949 title), inventing categories the data cannot support is the wrong
trade. Instead:

**Filter chips are drawn from the real tags themselves.** A chip means the
item genuinely carries that tag — zero inference, nothing to be wrong about.
Cleanup applied:

- Drop archivist placeholders: `need keyword`, `need meta`, `to come`,
  `needs keyword`, `tbd`.
- Case-fold to merge real duplicates (`industry`/`Industry`, `FOOD`/`Food`,
  `military`/`Military`, `home movies`/`Home movies`), displaying the most
  common original casing.
- Route decade-shaped tags (`1950s`, `1960s`, …) to the decade filter rather
  than the topic chip rail.
- Show only tags at or above a frequency threshold of **40 items**, giving
  **41 chips**.

**Honest coverage**: those 41 chips match ~18% of the catalogue. The tag
vocabulary is a long tail — 2,935 distinct topic tags across only 3,931
tagged items — so no threshold produces broad coverage (all tags at any
frequency still only reach 48%). Chips are therefore **entry points, not a
taxonomy**, and the UI must not imply otherwise. Search and decade carry
primary browsing.

## Browsing & filters

Grid/list toggle, search, tag chips, decade filter — same component
language as Public Screening.

**Search is the primary browse axis**, since it reaches the 87% of items
with a description; it covers title + subject + description. The decade
filter is secondary (61% resolvable). Tag chips are entry points for the
~18% they cover, per the section above.

Default sort by **downloads** — populated for 99% of items, the only signal
dense enough to order the whole catalogue. Newest/Oldest and Title A–Z as
alternatives. No rating-based sort: `avg_rating` exists but is thin (the
most-reviewed item sampled had 17 reviews; most have none).

No length/runtime filter in v1 — runtime requires a per-item metadata call
for all 8,039 items, and measured coverage was too sparse to justify the
scrape cost as a filter axis. Runtime is still shown on the detail panel
where the item reports it.

## Playback & detail panel

Same in-page embed as Public Screening: click to watch, `archive.org/embed/
<identifier>` loads inside the drawer, nothing hosted locally. Detail panel:
title, year, description, subject tags, runtime where reported, a link to
the full archive.org item page, and a download link — these works were frequently made to be
redistributed, worth surfacing that distinction from Public Screening's more
copyright-cautious framing.

## Favorites (My List)

Same feature as Public Screening: star from the grid or the drawer, a "My
list" toolbar checkbox that composes with other filters, its own
localStorage key kept separate from filter preferences so clearing filters
never un-stars anything. Proven pattern, reused as-is.

## Share pages

Same mechanism as Public Screening's `f/<id>/`: one static page per item
(~8,045 of them) with Open Graph tags and schema.org JSON-LD baked in at
build time, redirecting a human visitor into the app with that item open.
Necessary for the same reason it was necessary there — a `#id=` hash link
can never unfurl, on any host, because a hash is never sent to any server.

## Visual identity

Same dark theme and component language as Public Screening (card grid,
drawer pattern, monospace data labels, CSS custom properties) — reads as a
sibling app, not a clone and not a wholly separate design language. Distinct
enough to tell apart at a glance (different accent/name), consistent enough
that the hub feels coherent.

## Naming

**Ephemera** — the actual archival term for this content type ("ephemeral
film" is the established name for industrial/educational/ad shorts), short,
and clearly distinct from "Public Screening."

## Out of scope for v1

- Raw home movies (~2,422 items) — a genuinely different browsing problem,
  could be a future addition or a further-separate idea.
- Public Screening's "Search"/"Filters" preset chip rails — that grew out
  of specific design exploration on that app; not assumed here, could be
  added later using the same pattern if it proves valuable.
- Ratings/reviews as a first-class feature, given how sparse the underlying
  signal is.
