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

**Titled ephemeral films only** — roughly 8,045 of the collection's 10,467
items. The remaining ~2,422 are raw, untitled home movies (ID-numbered,
e.g. "Home Movie: 011083", tagged mainly by decade and broad subject) —
a different browsing problem, explicitly out of scope for this version.

## Data pipeline

One source, not seven: everything comes from archive.org's own search and
metadata APIs. This is a real simplification relative to Public Screening,
where title-only matching against multiple third-party databases was the
source of nearly every serious bug this project has had (wrong-film matches,
rewritten years, CSS injection via unescaped URLs). Here, each item already
carries a stable Archive identifier as its own primary key — no matching,
no ambiguity.

- `advancedsearch.php` (paginated) pulls the item list: identifier, title,
  year, subject, description, downloads, avg_rating.
- `metadata/<identifier>` fills in runtime and confirms a real video file
  exists (not just an image/text item mistakenly in the collection).
- Author-time only, `build-data.mjs`, never run in CI — same convention as
  Public Screening.

**Known coverage gaps**, measured from a live sample (not assumed): 86% of
items have a description, 51% a year, 44% a runtime. Filters and empty
states need to say when data is missing rather than presenting a gap as "no
results" — same ethos Public Screening already uses ("titles are matched by
name alone, so a few posters and years will belong to the wrong film").

**Posters**: Archive's own per-item thumbnail (`archive.org/services/img/`)
is the only source — there's no Wikidata/TVDB/fanart.tv equivalent for this
content type, since promotional art was never made for a 1953 hygiene
filmstrip. Sampled thumbnails during design were reasonably representative
(a field-line diagram for "Electromagnetism," a ship's deck for a naval
film) — better than expected, likely because a short instructional film's
early frames are more often *of* its actual subject than a random frame from
a 90-minute feature would be.

## Categorization

Subject tags on these items are messy free-text — decades, topics, and
places mixed together, inconsistent, occasionally literal placeholder junk
("need keyword"). A hand-curated category list, built by mapping the real
tag vocabulary (not guessed), same approach as Public Screening's
`GENRE_LABELS`. Starting point, to be finalized against the full scraped
tag set rather than a 200-item sample:

- Industrial & Training
- Educational
- Government & Military
- Advertising
- Newsreels & Current Events
- Social Guidance
- Home & Family

## Browsing & filters

Grid/list toggle, search (title + subject + description), category chips,
decade filter, length range — same component language as Public Screening.
Default sort by **downloads** (populated for nearly every item, a reliable
popularity proxy); Newest/Oldest and Title A–Z as alternatives. No
rating-based sort: archive.org's `avg_rating` exists but is thin (the most
reviewed sampled item had 17 reviews; most will have none), not a
meaningful "best" signal at this collection's scale.

## Playback & detail panel

Same in-page embed as Public Screening: click to watch, `archive.org/embed/
<identifier>` loads inside the drawer, nothing hosted locally. Detail panel:
title, year, description, category, length, link to the full archive.org
item page, and a download link — these works were frequently made to be
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
