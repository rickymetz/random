# Hub modern look: an editorial refresh — requirements

The modern look (the default everywhere) moves from a plain card grid to
a **bold editorial front page**: a lead story and two secondaries set as
full-colour blocks in a heavy grotesk, then the rest of the ideas as
compact rows. Emoji give way to **hand-drawn icons**, each idea in a
**flat** and a **3D soft-clay** style that the viewer chooses. These
requirements come from an interview held on 2026-09-23. They build on the
hub PWA (`2026-09-22-hub-pwa-requirements.md`) and sit alongside the
retro launcher (`2026-09-23-hub-gingerbread-retro.md`).

Why: the old look read as generic, and the retro launcher had outshone it.

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Motivation | It **felt generic and plain**, and **retro outshone it**. |
| 2 | Direction | **Bold editorial.** |
| 3 | Scope | **Restyle plus a new layout.** Features and the generated-from-`ideas/` pipeline stay as they are. |
| 4 | Front page | **A lead plus two secondaries**, then the rest. |
| 5 | Type | A **heavy grotesk** for headlines, with system sans for the text. |
| 6 | Font | **Self-hosted subset**: Archivo (OFL), pinned to a semi-expanded width (112) and weights 700–900, latin, WOFF2, ≈ 26 KB. |
| 7 | Colour | **Per idea.** Each idea has its own colour. |
| 8 | Colour strength | **Full colour blocks** for the lead and the secondaries. |
| 9 | The rest | **Compact list rows**: an icon on a colour swatch, the title, the description and the date, divided by rules. |
| 10 | Icons | **Hand-authored SVG per idea** in place of emoji. |
| 11 | Icon styles | **Flat** and **3D soft clay**, switchable by the user. |
| 12 | Toggle | In the **modern header** (Flat \| 3D) *and* in **retro Settings**. It is one shared preference. |
| 13 | Icon reuse | **PWA shortcuts**, **retro launcher tiles** and the **nav recents tray**. |
| 14 | Masthead | **A compact bar.** The lead story carries the drama. |
| 15 | Motion | **Hover lift** on blocks, a **staggered entrance** and an **idle loop** on the lead's icon. |

## Requirements

### E1. Layout

- The masthead is a compact bar: the `random` wordmark in the display
  face on the left and the header actions on the right (Install,
  Flat \| 3D, Retro look, Badge new ideas). Under it sits a one-line
  standfirst, "Small ideas, each one a tiny page.", with the idea count.
- The **front** has the newest idea as the **lead**: a large full-colour
  block with a big display title, the description, the date and the icon
  at hero size. The next two ideas are **secondaries**: medium blocks
  side by side. On a phone they stack, and the lead stays the largest.
- **More ideas**: every other idea is a compact row with a swatch icon,
  the title, the full description (never clamped) and the date. Rows are
  divided by hairline rules.
- With fewer than three ideas the front shows only what exists. With
  none, the empty message stays.
- Everything the hub already does keeps working: the New pill (nav.js
  puts it in `.card-top`, before the `time`), **Save offline** buttons,
  the Install button and iOS hint, the badge opt-in, and the switch to
  retro. The retro look hides `body > main` as before.

### E2. Colour

- `idea.json` gains `"color": "#rrggbb"`. Without one, build.js derives a
  colour from an FNV-1a hash of the slug, darkened until white text on it
  reaches 4.5:1.
- Text on a block is white or ink (#141414), whichever contrasts more.
  build.js warns when neither reaches 4.5:1.
- The paper is warm off-white (#f5f3ee) with #141414 ink in light mode,
  and #111 with #eeebe4 ink in dark mode. The blocks keep their colours
  in both.
- The retro tiles use the idea's colour too: `"icon"` (a hex) still wins,
  then `"color"`.

### E3. Icons

- Every idea ships `ideas/<slug>/icon-flat.svg` and `icon-3d.svg`: a 128
  viewBox, a transparent background, drawn to sit on the idea's colour,
  self-contained (no script, text or external references), with ids
  prefixed by the slug. Both files draw the same subject.
- **Flat** uses solid fills and poster geometry. **3D** is soft clay: top-left
  light, gradients, highlights and a soft contact shadow.
- build.js mirrors them to `icons/<slug>-flat.svg` / `icons/<slug>-3d.svg`
  at the site root. They are generated, precached with the hub shell and
  work offline for every idea, Cadence included. `ideas.json` lists them
  as `art: { flat, 3d }`.
- An idea without icons falls back to its emoji, or ✦, everywhere.
- All six listed ideas get icons in this refresh: Cadence, Ledger,
  Ephemera, Public Screening, Container Compound and Breathe.

### E4. Flat / 3D switch

- The choice is stored as `random-hub:icons` = `flat` | `3d`. The
  **default is flat**, which fits the flat-colour editorial blocks. It is
  set on `<html data-icons>` before first paint, like `data-look`.
- The modern header has a two-button segmented control (`aria-pressed`).
  Retro Settings → Display has an "Icon style" row. Both call
  `randomNav.setIcons()`, which fires a `randomicons` event, and every
  surface re-renders at once: the hub, the tray and the launcher.

### E5. Where the icons appear

- **Modern hub**: the lead, the secondaries and the rows.
- **Nav recents tray**: a small colour swatch with the icon, in place of
  the emoji.
- **Retro**: the launcher tiles (home, dock, drawer, search), the
  dialogs' tile, and the tiles in the offline page's retro list.
- **PWA shortcuts**: each shortcut lists its 3D SVG icon, with
  `icon-192.png` as the fallback.

### E6. Motion

- Blocks and rows lift slightly on hover and focus, and the icon nudges.
- The front and the rows fade and slide in once on load, staggered by
  about 60 ms.
- The lead's icon floats gently for three slow cycles, then rests. The
  lead moves in without fading, so it paints at once (it holds the LCP).
- Hover effects apply only where hover exists (`@media (hover: hover)`).
- `prefers-reduced-motion: reduce` turns off all three. Content never
  depends on an animation to become visible.

### E7. Accessibility

- Text on blocks meets AA (E2). Focus rings are visible on the paper
  and on the blocks.
- Icons are decorative (`alt=""`, and the wrapper is `aria-hidden`),
  because the title names the idea.
- Targets are at least 44 px on touch.
- A card link's name is its title (plus "New"); its blurb is the
  description.
