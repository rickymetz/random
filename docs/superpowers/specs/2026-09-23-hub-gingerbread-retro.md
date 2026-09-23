# Hub retro mode: early-Android (Gingerbread) — requirements

When the hub runs as the **installed app**, it should feel like an early
Android phone: a Gingerbread (2.3) launcher with home screens, an app
drawer, widgets, a live wallpaper, a status bar with a pull-down shade and
matching system chrome. The browser keeps today's clean card grid. These
requirements come from a 30-question interview held on 2026-09-23. They
build on the hub PWA (`2026-09-22-hub-pwa-requirements.md`), which is
live.

The goal is a *loving homage*: unmistakably the era, but crisp on modern
screens and meeting today's touch and accessibility standards. It is not
a replica. There's no Android robot, no Google logos or wordmarks, and no
copied system artwork. Everything is drawn fresh in the era's style.

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Era | **Gingerbread 2.3**: black, lime/green highlights, flat-ish. |
| 2 | Where it applies | The installed app, with a **toggle**. Retro is the default when installed, and a setting switches it to modern (or tries retro in the browser). |
| 3 | Scope | The **hub plus system chrome**: home screen, bar, recents, toasts, offline page. Idea *content* is untouched. |
| 4 | Fidelity | Loving homage, not a pixel replica. |
| 5 | Layout | **Home screens plus an app drawer.** |
| 6 | Home screens | **3**, swipeable, with page dots. |
| 7 | Home icons | **Every idea** on the home screens; the drawer lists them all too. |
| 8 | Dock | **Drawer button plus 2 favourite slots.** |
| 9 | Icons | **Era-style tiles**: each idea's emoji on a top-lit, slightly 3D tile, tinted per idea. |
| 10 | Wallpaper | **Animated live wallpaper**: drifting glowing particles or light streaks. |
| 11 | Widgets | **Search bar, clock, "New ideas", power control.** All four. |
| 12 | Dock favourites | **Long-press → "Add to dock".** It starts with the two most recently opened. |
| 13 | Status bar | **Real data**: clock, battery, online/offline, a notification icon. Nothing faked. |
| 14 | Shade | **Pull-down shade with real events**: new ideas, saved-for-offline, a pending update. |
| 15 | Nav bar | **Keep ◀ ● ■**, restyled for the era, plus a 4th **≡ Menu** key (#21). |
| 16 | Recents | **Both**: long-press ● opens the Gingerbread recents dialog, and ■ still opens the tray. |
| 17 | Long-press ● | In retro mode it opens the **recents dialog**. Share moves to the ≡ menu and the icon menu. Modern mode is unchanged (long-press ● = Share). |
| 18 | Icon long-press | An **era context menu**: Open, Add to/Remove from dock, Save offline, Share, About this idea. |
| 19 | Launch | **Zoom transition plus a loading overlay** if the idea is slow. |
| 20 | Boot animation | **Once per cold start**, about 1.5 s, tap to skip. |
| 21 | Menu | **A 4th key, ≡**, on the bar: ◀ ● ■ ≡. |
| 22 | Font | **Bundled Droid Sans** (Apache 2.0), woff2 in the repo. |
| 23 | Feedback | **A haptic tick** on key taps and long-presses, plus **era UI sounds** (Web Audio, off by default). |
| 24 | Drawer | The **Gingerbread vertical grid**. |
| 25 | Device status bar | **Blend under it.** Keep `standalone`, paint the device bar to match, and ours sits beneath. |
| 26 | Settings | An **era "Settings" app** inside the hub. |
| 27 | Light/dark | **Follow the system.** |
| 28 | Idea pages | Idea pages get the **retro 4-key bar too**. |
| 29 | Light variant | **"Paper Gingerbread"**: warm off-white, the same shapes, a pale wallpaper and darker green accents. The status and nav bars stay black, like hardware. |
| 30 | Clock | **Switchable**: tap to flip between digital and analog, remembered. |

## Requirements

### G1. Mode and switching

- There are two looks: **modern** (today) and **retro** (this spec),
  stored in `localStorage` as `random-hub:look` = `retro` | `modern`.
- Default: **retro when installed** (`display-mode: standalone` or
  `navigator.standalone`), **modern in a browser tab**. A saved choice
  always wins, so a browser user can opt into retro and an installed user
  can opt out.
- The toggle lives in Settings (G16), the ≡ menu and the power-control
  widget. In modern, a "Retro look" button in the hub header is the way
  in. Switching applies at once: no reload, no flash of the wrong
  look on the next start. `<html data-look>` is set by an inline
  head script before first paint.
- Retro is always the look **inside the installed app shell**. Idea page
  *content* is never restyled (only the bar, dialogs and toasts `nav.js`
  draws).

### G2. Palette and type

- **Dark (default in dark mode):** a black base (#000); panels #1b1b1b to
  #2b2b2b with subtle top-lit gradients; text #fff and #b3b3b3; and a
  Gingerbread **lime/green highlight** (≈ #9fd01d) for focus, pressed
  and selected states.
- **Paper Gingerbread (light mode, G27/G29):** a warm off-white
  (#faf9f7) base with the same shapes, a pale wallpaper and green
  darkened to meet WCAG AA on light (≈ #4d7a00). The status and nav bars
  stay black.
- The hub's rust accent (#b3542e / #e08554) survives in the "r" logo,
  the boot animation and the wallpaper tint, so the app is still
  recognisably "random".
- **Font:** Droid Sans (regular and bold), bundled as woff2 under
  `fonts/` with its Apache 2.0 licence, precached by the worker, and
  used only in retro mode.
- Touch targets are at least 48 px; text contrast is at least AA in both
  variants.

### G3. Home screens

- **3 home screens**, swiped horizontally with scroll-snap (and the arrow
  keys), plus Gingerbread page dots above the dock. It opens on the centre
  screen.
- **Every idea** appears as an icon on the home screens, flowing across
  the 3 pages in a 4-column grid after the widgets, newest first.
  - The centre page holds the search and clock widgets first.
  - The left page holds the "New ideas" widget.
  - The right page holds the power-control widget.
  - Icons fill the remaining cells.
- Labels sit under the icons in white with a soft text shadow (paper
  variant: dark ink), truncated to one line.
- The "New" state (unopened, added since `random-hub:since`) shows as a
  small green dot on the icon's corner. The logic is unchanged.

### G4. App drawer

- The dock's centre button (a Gingerbread dotted grid) opens the
  **drawer**: a full-screen panel that slides up, with a vertical 4-column
  grid of every idea and an A–Z / Newest sort toggle (remembered). Back
  or ● closes it.
- Drawer icons have the same long-press menu (G7).

### G5. Dock

- A dock bar above the nav bar has the **drawer button** in the centre
  and **2 favourite slots**, one either side.
- Favourites start as the two most recently opened ideas (the drawer's
  newest two if none have been opened). "Add to dock" / "Remove from dock"
  in the icon menu sets them, stored as `random-hub:dock` (at most 2).
  Adding to a full dock replaces the older slot.

### G6. Icons

- **Era tiles** are generated in the page, not image files: the idea's
  emoji centred on a rounded-square tile with a top-lit gradient, a 1 px
  inner highlight, a slight perspective tilt and a soft drop shadow.
- Each idea's tile colour comes from a stable hash of its slug (a curated
  palette of about 8 era-appropriate hues). An optional `icon` colour in
  `idea.json` overrides it.

### G7. Long-press icon menu

- Long-pressing (about 500 ms; on desktop, right-click) an icon on a home
  screen, in the drawer or in the dock opens a Gingerbread **context menu
  dialog** titled with the idea's name. It offers:
  - Open
  - Add to dock / Remove from dock
  - Save offline / Saved ✓ (the existing pin mechanism; hidden for
    ideas that keep themselves offline)
  - Share
  - About this idea
- **About this idea** is an era dialog with the emoji tile, title,
  description, date added, and offline status (saved / cached / not
  cached).
- A haptic tick fires when the menu opens (G15).

### G8. Launch transition

- Tapping an icon **zooms** it up from its position to fill the screen
  and fades into the idea. This uses a cross-document View Transition
  where supported, and a short CSS zoom before navigating elsewhere.
- If the idea hasn't painted within about 600 ms, an era **"Loading…"
  overlay** (a spinner and the idea's name) appears until it does.
- Reduced motion: no zoom and no overlay animation, just the instant
  switch.

### G9. Boot animation

- On a **cold start of the installed app** (first page load of a new
  session: nothing in `sessionStorage`), a black screen shows the "r" logo
  assembling with a rust glow and the word "random" in Droid Sans for
  about 1.5 s. It then fades into the home screen.
- Tapping skips it. It never plays on in-app navigation, never in modern
  mode, and never with reduced motion (a short fade only).

### G10. Live wallpaper

- A full-bleed `<canvas>` behind the home screens: slow glowing particles
  or light streaks, mostly neutral with a rust/lime tint. The paper
  variant is pale with soft grey-green motes.
- It moves with a gentle parallax as the home screens are swiped (as the
  era's live wallpapers did).
- It pauses when the page is hidden, the drawer is open or an idea is
  launching; it's capped at about 30 fps and scaled to the device pixel
  ratio. With reduced motion, or when "Wallpaper motion" is off, a static
  render is shown.

### G11. Widgets

1. **Search bar.** An era search box (unbranded: a magnifier icon and
   "Search ideas"). Typing filters the ideas live across title and
   description in a results panel. Enter opens the top match.
2. **Clock.** Large and switchable: tap to flip between a big thin
   **digital** clock with the date and a glossy **analog** clock. The
   choice is remembered. Times are local.
3. **New ideas.** Lists up to 3 ideas that are new and unopened, with
   "No new ideas" otherwise. Tapping one opens it.
4. **Power control.** A row of era toggle buttons with a lit bar under
   each:
   - look (retro/modern)
   - sounds
   - haptics
   - wallpaper motion
   - storage, which opens Settings → Storage

### G12. Status bar and notification shade

- **Status bar** (retro, top of the hub): black, about 25 px, below the
  device's own bar (the manifest stays `standalone`, and `theme-color` is
  black in retro so the two blend). It shows:
  - **Clock:** the real local time.
  - **Network:** a real online/offline glyph from `navigator.onLine` and
    its events.
  - **Battery:** the real level and charging state via
    `navigator.getBattery()` where available, otherwise **not shown**
    (never faked).
  - **Notifications:** a small icon when the shade has unread items.
- **Shade:** dragging the status bar down (or tapping it) pulls down a
  Gingerbread shade with the date, an "Ongoing"/"Notifications" section
  and a **Clear** button. Items come from real events:
  - "N new ideas", one per new idea (tapping opens it)
  - "Saved for offline: X", after a save
  - "Update ready — tap to refresh", when a new worker is waiting (the
    same action as today's toast)
  - "You're offline", while offline
- Dismissed items are remembered per item (`random-hub:shade-dismissed`).

### G13. Nav bar (retro)

- The same bar and behaviour as today, restyled as a black Gingerbread key
  row with soft glowing white glyphs and a lime press highlight:
  **◀ Back, ● Home, ■ Recents, ≡ Menu**.
- It's used on the hub **and on idea pages** (retro look only; modern
  keeps today's colour-matched ◀ ● ■).
- **≡ Menu** opens a Gingerbread **options panel** that slides up: a
  2×3 grid of icon+label buttons.
  - On the hub: Wallpaper, Search, Settings, Look (retro/modern), Share
    hub, About.
  - On an idea page: Share, Save offline, About this idea, Settings,
    Home, Look.
- **● long-press (retro)** opens the **recents dialog**: a dark dialog
  with a 2×4 grid of the last 8 opened ideas' tiles and labels. Tap to
  open; Back/outside tap closes it. (Modern: long-press ● stays Share.)
- **■** still opens today's tray, restyled in retro.
- The bar's immersive hide/handle, `--random-nav-h` and the event
  isolation are all unchanged.

### G14. Dialogs, toasts, offline page

- All `nav.js`/hub dialogs (context menu, About, recents, options) use
  Gingerbread dialog styling: a dark grey panel, a title bar with a thin
  divider, and full-width stacked buttons. The paper variant is
  light-grey.
- **Toasts** use the era toast: a small rounded dark-grey box with white
  text, centred above the bar.
- **Offline page** in retro: an era "No connection" screen (a signal
  glyph, a message, a **Retry** button) and the cached ideas as an icon
  grid.

### G15. Sound and haptics

- **Haptics:** `navigator.vibrate(10)` on key taps and a 25 ms buzz on
  long-press menus. Android only (a silent no-op elsewhere). On by
  default; toggle in Settings and the power widget.
- **Sounds:** synthesised with Web Audio, with no audio files: a soft
  click on key taps, a two-note "unlock" chime when the boot animation
  ends, and a tick on page swipe. **Off by default.** The audio context
  starts only after a user gesture.

### G16. Settings app

- A full-screen **Settings** screen in Gingerbread list style: section
  headers, rows with a title, summary and checkbox/chevron. Open it from
  ≡ → Settings or the power widget. Back closes it. It has:
  - **Display:** Look (Retro / Modern), Wallpaper motion, Clock
    style (Digital / Analog)
  - **Sound & feedback:** UI sounds, Haptic feedback
  - **Home screen:** Reset dock, Reset home order (if any is added
    later)
  - **Storage:** saved-for-offline ideas (unpin each), cache usage (from
    `navigator.storage.estimate()`), "Clear cached ideas" (keeps saved)
  - **About:** app version (the worker's VERSION), idea count, a
    link to the source, credits and licences (Droid Sans, Apache 2.0)
- All settings live in `localStorage` under `random-hub:*` keys, wrapped
  in try/catch.

## Architecture notes

- New files: `retro.js` (the launcher: home screens, drawer, dock,
  widgets, shade, boot, settings) and `retro.css`, both precached. The
  retro look is drawn only when active; the modern hub markup stays for
  modern mode and for no-JS.
- `nav.js` gains a retro skin (≡ key, options panel, recents dialog, era
  toasts) chosen by the same `random-hub:look`.
- `build.js`: add `retro.js`, `retro.css` and the fonts to the shell
  (the worker's VERSION hash covers them). `ideas.json` already has
  what the launcher needs; add an optional `icon` colour from `idea.json`.
- There are still no dependencies and no build step beyond `build.js`.

## Acceptance checks

1. A fresh install opens in retro. After the boot animation it lands on
   the centre home screen with the status bar, search and clock widgets,
   icons, page dots, dock and ◀ ● ■ ≡.
2. In a browser tab it's modern by default. Settings → Look → Retro
   switches instantly and survives a reload; modern is reachable from
   retro the same way.
3. There are three swipeable home screens. The drawer opens from the dock
   and lists every idea in both sort orders.
4. Long-pressing an icon gives the context menu, and every action works
   (dock, save offline, share, about).
5. The status bar shows real time and online state. Battery shows only
   where the API exists. The shade lists a new idea, a completed save
   and a pending update, each actionable. Clear empties it.
6. Retro ≡ opens the options panel on the hub and on an idea page. In
   retro, long-press ● opens the recents dialog; in modern it shares.
7. The live wallpaper pauses when hidden. With reduced motion there is
   no wallpaper motion, zoom or boot animation.
8. Both paper and dark variants follow the system setting, and text
   meets AA in both.
9. It works offline once installed (fonts and retro assets precached).
10. `scripts/test/hub-e2e.mjs` gains retro coverage for 1–7, and the
    existing modern checks still pass.

## Open questions

None. Every requirement question has been answered. Smaller visual
choices (exact tile hues, particle style) are left to the implementation,
within the palette above.
