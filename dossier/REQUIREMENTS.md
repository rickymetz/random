# Dossier — Requirements & Architecture

A privacy-first personal memory aid: a PWA for keeping dossiers on the people
you meet — what they do, who they love, what they like — with an
Obsidian-style relational graph of how everyone connects.

This document is the blueprint for v1 and the design constraints that keep
v2 possible without rework. It reflects the requirements interview held on
2026-09-09; the decisions from that interview are summarized in
[Appendix A](#appendix-a--decision-log).

---

## 1. Product summary

You meet someone. They tell you about their job, their kids, their divorce,
their hatred of cilantro. Six weeks later you're about to see them again and
you remember none of it. Dossier is the tool you open in the thirty seconds
after the conversation (quick capture) and the thirty seconds before the next
one (instant recall).

Because a database of other people's private lives is a honeypot, the
defining constraint is that **the data never leaves the device and is never
readable at rest**. There is no server, no account, no analytics, no
plaintext on disk. Portability comes from encrypted export files the user
moves themselves.

**Audience:** built for the author first, but every architectural choice must
survive a later public release (schema, crypto, onboarding-shaped code paths).

## 2. Goals and non-goals

### Goals

- Sub-30-second capture of a fact about a person, on a phone.
- Instant lookup: open a person's dossier and refresh your memory in seconds.
- A fully interactive relationship graph that is a core feature, not a toy.
- Real encryption at rest; a borrowed or stolen device yields nothing.
- Encrypted export/import as the only way data crosses devices.
- Architecture that can later add zero-knowledge sync and a decoy vault
  without a storage or crypto rewrite.

### Non-goals (v1)

- No server, no sync service, no accounts.
- No multi-user features, sharing, or collaboration.
- No plaintext export.
- No arbitrary file attachments (photos of people only).
- No voice capture.
- No legal/compliance treatment — deferred until a public release is planned.
- No decoy vault implementation (but the storage format must accommodate it —
  see §6.6).

## 3. Primary scenarios

The two scenarios below drive every UX decision; anything that slows them
down needs a strong reason to exist.

**S1 — Quick capture after meeting.** You just left a conversation. From the
home screen: open app → biometric unlock → tap the person (or "+ new
person") → type 2–3 loose facts → done. Target: under 30 seconds, one hand,
walking. Loose text is acceptable at capture time; sorting into structured
fields can happen later ("inbox" model).

**S2 — In-the-moment lookup.** You're walking into a dinner. Open app →
unlock → search-first UI → type three letters of a name → person page leads
with the things you need: face, partner/kids' names, last notes, open
follow-ups ("ask how the surgery went"). Read speed and search latency
matter more than anything else on this path.

## 4. Functional requirements

### 4.1 Dossiers (people)

Each person is a dossier with **structured fields plus free notes**:

- **Identity:** display name, nickname(s), pronouns, avatar photo, optional
  extra photos.
- **Structured facts:** job title, employer, location, birthday (full or
  partial — "sometime in June" must be representable), how/where we met,
  contact details.
- **Likes / dislikes:** tag-like lists, free-vocabulary.
- **Free notes:** a running notes area supporting `@mention` links to other
  people (see 4.2) and lightweight formatting. Notes entries are timestamped
  so the dossier doubles as a loose interaction log.
- **Follow-ups:** dated or undated "ask about X" items that surface in
  reminders and at the top of the person page.
- **Tags:** free-form tags on the person (e.g. `climbing`, `work`,
  `neighbor`) usable as graph filters.

A **quick-capture inbox**: facts entered in a hurry land as unsorted note
lines on the person; a later triage affordance suggests promoting them to
structured fields. Structure must never be a prerequisite for capture.

### 4.2 Relationships and the graph model

- **Typed, directed edges** between people: a built-in vocabulary (friend,
  partner/dating, married, sibling, parent/child, coworker, boss/report,
  roommate, …) with direction where meaningful (parent→child).
- **Roles on a link.** A pair may carry several relationships at once — a
  coworker who is also a former partner — each its own edge with its own
  type; the same role never twice on a pair. Any role can be marked
  **former**, with an optional start and end (partial dates: a year, a
  month, a day). "Ex" is not a type: it is partner + former, and "ex",
  "ex-partner", "former coworker" resolve that way wherever a role is
  typed. Former roles draw long-dashed, can be hidden with one chip, and
  "How you connect" walks current ties first, falling back through former
  ones only when nothing current connects you.
- **Custom relationship types:** users can define their own types with a
  label, color, and directionality. Custom types are first-class in filters
  and rendering.
- **Mention-derived links:** an `@mention` of person B in person A's notes
  automatically creates (or reinforces) an untyped "mentioned" edge A→B.
  These render distinctly (dashed) and can be upgraded to a typed edge in
  one tap. Deleting the mention text removes the derived edge unless it was
  upgraded.
- Edges may carry an optional free-text note ("met at Dana's wedding"), a
  start date and an end date.

### 4.3 Graph visualization

The graph is a **core feature** and gets real engineering investment:

- Force-directed layout of all people; pan, zoom, drag, with touch and
  mouse parity.
- Nodes show avatar (or initials) and name at sufficient zoom; edge color =
  relationship type.
- **Filters:** by relationship type (built-in and custom), person tags, and
  "hide mention-only edges".
- **Ego view:** center on one person and show only their world (direct
  connections, optionally 2 hops), reachable from every person page.
- Click/tap a node → peek card → through to the full dossier. Tap an edge →
  edit its type/note.
- Must stay fluid to at least ~500 nodes / ~2,000 edges on a mid-range
  phone; degrade gracefully (labels first, physics second) beyond that.

### 4.4 Recall and intelligence

- **Full-text search** across names, nicknames, all structured fields,
  tags, notes, and edge notes. Search is the home screen's primary
  affordance and must return results as-you-type (<50 ms perceived). "Who
  was the guy with the sailboat?" must work.
- **Reminders & dates:** birthdays and dated follow-ups produce
  notifications where the platform allows (see §7 for iOS constraints) and
  always appear in an in-app "upcoming" view, which is the reliable
  fallback. Notification text must be generic (see §6.5).
- **Graph queries**, surfaced as UI features rather than a query language:
  - Mutual connections between two people.
  - "How do I know X?" — shortest path(s) from a designated "me" node.
  - Cluster/social-circle detection as a graph coloring mode.

### 4.5 Export / import

- **Encrypted export only.** Export produces a single `.dossier` file: the
  full vault (people, edges, photos, settings) encrypted with the vault's
  existing key material (§6.3). There is deliberately no plaintext export
  in v1 — the export file must be safe to park in any cloud drive.
- Import on a fresh device prompts for the passphrase and restores
  everything, including re-offering biometric enrollment.
- Export is also the backup story: the app nags (gently, locally) when the
  vault has changed materially since the last export.

### 4.6 Circles

A **circle** is a named group of people — "college friends", "DC polycule",
"Meridian Labs" — drawn as a translucent bubble on the graph. Decided in the
circles interview (Appendix A):

- **First-class entity**, separate from tags: `name`, `color`, `memberIds`.
  Tags stay lightweight words; a circle can later grow a description or
  events without a migration.
- **Many-to-many, flat.** A person may be in any number of circles; circles
  never nest. Overlaps are the point (a person in two circles sits between
  them).
- **Graph rendering:** a soft convex hull (padded, rounded) behind the
  members with the name floating above it. A weak layout force pulls
  members toward their circle's centroid so bubbles stay compact; edges
  still dominate. Bubbles draw beneath edges and nodes.
- **Graph controls:** circle chips (hollow-ring glyph, grouped ahead of the
  relationship-type chips) show/hide each bubble; tapping a bubble — or the
  ✎ on its chip, which is also the keyboard/screen-reader path and the only
  path for an empty circle — opens a circle card (name with collision
  check, color swatches, members with remove and an "Add someone…" picker,
  "Only this circle" / "Show everyone", Delete). Focus draws only that
  circle and its members (`?circle=<id>`). Bubbles are a single offset
  outline of the members' hull (fill 0.09, outline 0.45) with zoom-scaled,
  collision-avoiding labels; a centroid force keeps members together.
- **Colors:** auto-assigned from a muted palette (next unused hue); the
  card's swatches override.
- **Managed from the person page:** a "Circles" chip field on the edit
  form (existing names suggested; a new name creates the circle). Each
  circle chip on the details card links to the People list filtered to
  that circle; People rows show small membership dots; circle names are
  searchable.
- **Lifecycle:** removing the last member leaves an empty circle (no
  bubble; still offered as a suggestion). Deleting a circle removes only
  the grouping — people are untouched. Deleting a person removes them
  from every circle.
- **Discretion:** circle names never appear on the lock screen or in
  notifications (§6.5); they are ordinary encrypted records (§6.1) and
  travel in backups.
- **Sample cast** seeds three overlapping circles so the demo shows
  intersecting bubbles.

Deferred: circles as filters in "How you connect", nested circles, a
dedicated Circles screen, lasso-to-circle on the canvas.

## 5. Threat model

In scope, in priority order:

| # | Threat | Primary mitigations |
|---|--------|--------------------|
| T1 | **Someone borrowing the unlocked phone** — a friend, partner, or the very people in the dossiers poking around | Auto-lock on backgrounding + inactivity; instant-lock/panic gesture; neutral app name/icon; generic notification text |
| T2 | **Export file leakage** — the backup lands in someone else's hands via cloud breach or misdirected share | Exports are always ciphertext; no plaintext export path exists; filename is nondescript |
| T3 | **Future server / data-at-scale** — if sync or a public launch happens, the operator and legal process must be unable to read user data | All crypto is client-side from day one; the sync layer (v2) only ever transports ciphertext; key material never leaves the device unwrapped |
| T4 | **Lost/stolen locked device** (secondary) | Encryption at rest with passphrase-derived keys; nothing readable in IndexedDB without unlock |

Out of scope: forensic adversaries with the device *and* the passphrase,
compromised OS/browser, malware with memory access, and coerced unlock
(the v2 decoy vault addresses the last one).

**Residual metadata (accepted, documented):** a raw dump of the encrypted
store reveals the total record-row count and each row's ciphertext size —
but no timestamps, no mapping from vault slots to rows (the per-vault row
prefix is itself sealed under the DEK), and no record kinds within the
text-record store. Two coarse kind distinctions are visible from table
names alone: photo payloads live in a separate `blobs` store (so photo
count and per-photo ciphertext size are observable — a known-image size
fingerprint is possible), and biometric enrollments live in an `auth`
store (so their existence and count are observable). Padding rows/sizes
to hide counts is a possible v2 hardening, not a v1 goal.

## 6. Security architecture

### 6.1 Storage and encryption at rest

- All persistent data lives in IndexedDB **as ciphertext only**. Every
  record is stored as `{id, iv, blob}` where `blob` is AES-256-GCM
  ciphertext; no field names, note text, or photo bytes are ever persisted
  in plaintext. Record IDs are random UUIDs (no semantic leakage).
- Photos are encrypted with the same envelope and stored as blobs.
- On unlock, records are decrypted into an **in-memory store**; search
  indexes and the graph are built in memory and never persisted. Lock (or
  panic) drops the key and the in-memory store.

### 6.2 Key hierarchy (envelope design)

This is the piece that must be right from day one, because biometric
unlock, passphrase changes, encrypted sync, and the decoy vault all hang
off it:

```
passphrase ──KDF──▶ KEK ──unwraps──▶ DEK ──decrypts──▶ all records
WebAuthn PRF ──────▶ KEK'──unwraps──▶ DEK   (same DEK, second wrap)
```

- A random 256-bit **DEK** (data encryption key) encrypts all records.
- The DEK is stored only **wrapped**: once by a **KEK** derived from the
  passphrase, and optionally again by a key from **WebAuthn PRF** for
  biometric unlock. Adding/removing unlock methods and changing the
  passphrase re-wraps the DEK; the data is never re-encrypted.
- **KDF:** Argon2id (`hash-wasm`, 48 MiB / 3 passes / p=1, ~250 ms on a
  mid-range phone) for new vaults and export bundles; legacy
  PBKDF2-SHA-256 (600k) wraps migrate transparently on the next
  passphrase unlock. Parameters are versioned per slot/header and
  bounded wherever they arrive from untrusted sources. Known trade: the
  WASM module's working memory can't be zeroized from JS, so Argon2id
  leaves more transient key-derivation residue in memory than the
  WebCrypto PBKDF2 path did — accepted for its GPU-resistance.
- The raw DEK exists only in memory while unlocked, held as a
  non-extractable WebCrypto `CryptoKey` wherever the API allows.

### 6.3 Unlock methods (all three ship in v1)

1. **Passphrase** — the root of trust; always available; required for
   export/import and for enrolling other methods. Forgotten passphrase =
   lost data, stated loudly at vault creation.
2. **Biometric via WebAuthn PRF** (platform passkey) — daily-driver unlock:
   the PRF output unwraps the DEK. Falls back to passphrase where PRF is
   unsupported.
3. **PIN + auto-lock** — a short PIN for re-unlock within a session window,
   wrapping a session copy of the DEK with strict attempt limits (5 tries →
   full lock, passphrase required). Auto-lock fires on a configurable
   inactivity timer (default 2 min) and on backgrounding — after a short
   grace period (~30 s), because an instant background-lock destroys
   in-progress capture drafts on every notification tap and breaks the OS
   file picker, which backgrounds the page. The one-tap panic lock (§6.4)
   remains the instant path.

### 6.4 Instant lock / panic

- A persistent one-tap lock control in the app chrome, plus shake-to-lock
  on devices that expose motion events.
- Locking zeroizes the DEK reference and discards the in-memory store
  immediately; the UI drops to the unlock screen with no content flash
  (skeleton only).
- The panic lock also discards the session PIN wrap (§6.3) — nothing
  PIN-openable may remain in memory after a panic. Timer-driven
  auto-locks keep the PIN armed (quick re-entry is their point) and
  flush any in-progress capture draft into an encrypted note first.

### 6.5 Discretion / disguise

- Installable under a **neutral name and icon** (user picks from a small
  set at install time; the manifest is generated accordingly).
- Notifications never contain a person's name or fact — always generic
  ("You have a reminder").
- The unlock screen is visually bland and shows no vault metadata (no
  "342 people" counts).

### 6.6 Decoy vault — design now, build in v2

The storage layout ships decoy-ready in v1 even though only one vault is
created:

- IndexedDB holds a list of **vault slots**; each slot is
  `{saltₖ, kdfParams, wrappedDEK, dataPrefix}` with no plaintext label.
  Records are namespaced by an opaque per-vault prefix.
- Unlock tries the entered passphrase against every slot; whichever slot's
  wrap opens is the vault you get. Wrong-passphrase and
  other-vault-passphrase are **indistinguishable outcomes by design**.
- v1 creates one slot (plus, always, a second dummy slot of random bytes so
  a single-slot store doesn't prove there's no decoy). v2 adds the UI to
  create a real second vault.

### 6.7 General hygiene

- No third-party network requests at runtime; CSP locked to `'self'`.
  Dependencies are vendored/bundled at build time.
- No analytics, no error reporting to remote services.
- Clipboard writes (e.g. copying a phone number) warn-once about clipboard
  history/sync.
- A "destroy all data" action (typed confirmation) wipes IndexedDB and
  caches — the app's remote-wipe stance is that there is nothing remote to
  wipe.

## 7. PWA & platform requirements

- **Mobile-first**, installed-PWA as the primary form factor; responsive
  desktop layout that is genuinely good for desk sessions and the big
  graph (keyboard search, larger canvas).
- **Offline-first:** the app is fully functional with no network, forever.
  Service worker precaches the entire app shell (`vite-plugin-pwa`).
- **iOS realities** are first-class concerns:
  - Request `navigator.storage.persist()` and surface its result; on iOS,
    prominently push the encrypted-export habit because Safari can evict
    storage for unused sites — **export is the durability story, not a
    nice-to-have**.
  - Web Push on iOS requires the installed (Home Screen) PWA and user
    opt-in; the in-app "upcoming" view is the guaranteed path for
    reminders, notifications are best-effort.
  - WebAuthn PRF availability varies; feature-detect and fall back
    cleanly to passphrase.
  - **A Safari tab and the Home Screen app are separate worlds** (separate
    storage, notifications only from the installed app). The app says so
    on the create screen and in Settings when it detects an iOS tab, and
    points to backup → restore for moving a vault across.
  - **Keyboard vs. bottom bars:** iOS overlays the keyboard on the layout
    viewport (`interactive-widget=resizes-content` is Android-only), so
    the app tracks `visualViewport` and lifts its bottom-anchored bars
    (capture bar, form Save row) by the covered height (`--kb`).
  - Keyboard lifting and `dvh` need iOS 15.4+ (`:has()`); older iOS
    degrades to bars that stay put and `100vh`, never to a broken layout.
    The graph uses `svh` so a Safari tab's collapsing toolbar doesn't
    re-fit the canvas on every scroll.
  - Motion access for shake-to-lock is re-requested on the first tap of
    every launch (iOS grants it per page load); the backup is offered
    through the share sheet on iOS (an `<a download>` of a blob is
    unreliable from a Home Screen app); Face ID enrolment is skipped up
    front where the browser reports no PRF support, so no orphan passkey
    is minted.
- **Scale targets** (a "several hundred people" address book, §4.4):
  300 people / 1,000 notes must feel instant on a mid-range phone —
  search keystroke under ~100 ms, People list and dossier open under
  ~500 ms, graph settling in under ~10 s — and 1,000 people must remain
  usable. Verified with a deterministic bulk crowd (Settings → `?dev=1`
  → Stress test, one encrypted write via the import path) and a
  Playwright profiling script under 4× CPU throttling. Design
  consequences: per-snapshot indexes for per-person lookups (notes,
  photos, avatar, circles) instead of record scans per row; the People
  list renders in pages of 60 (sentinel + "Show more") with letter
  headers and a capped Upcoming strip so the list stays above the fold;
  a Recent row (last dossiers opened, kept in the encrypted device-local
  Settings record, padded with recently updated people to six) and a
  right-edge A–Z jump rail that belongs to the list — shown only once the
  list has scrolled up, tap or drag, one keyboard stop with arrow keys,
  focus follows a keyboard jump — make hundreds of names two taps away; search combines words with AND and every hit says why it matched
  (field, tag, circle, or note snippet); every person-choosing field is
  a typeahead (a native select of 300 names is a picker wheel on iOS); the graph batches draw calls
  by style, cools faster and paints every other tick above 150 nodes,
  and past the label limit opens on your own connections (§4.3) with
  "Show everyone" one tap away.
- Target browsers: latest Safari (iOS/macOS), Chrome, Firefox, Edge. No
  legacy support.

## 8. Data model

Entities (all persisted encrypted, per §6.1):

- **Person** — `id`, identity fields, structured facts, likes/dislikes,
  tags, photos (blob refs), createdAt/updatedAt.
- **NoteEntry** — `id`, `personId`, timestamped rich-text-lite body,
  extracted `@mention` person-ids.
- **FollowUp** — `id`, `personId`, text, optional due date, done flag.
- **Relationship** — `id`, `fromId`, `toId`, `typeId`, directed flag,
  note, startDate, `origin: explicit | mention`.
- **RelationshipType** — `id`, label, color, directional flag,
  `builtIn` flag.
- **Photo** — `id`, `personId`, encrypted blob, isAvatar.
- **VaultMeta** (per slot, §6.6) and **Settings** (lock timers, disguise
  choice, reminder prefs, last-export timestamp).

A `schemaVersion` in the vault header plus per-record versioning enables
forward migration; the export format embeds the same version.

## 9. Technical architecture

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript, Vite |
| PWA | `vite-plugin-pwa` (Workbox), generated manifest per disguise choice |
| Routing | `react-router` (unlock gate wraps all data routes) |
| Persistence | IndexedDB via Dexie — ciphertext records only |
| Crypto | WebCrypto (AES-GCM, HKDF); Argon2id via WASM (v1.x); WebAuthn PRF |
| In-memory store | Zustand (or equivalent) holding decrypted domain objects; rebuilt on unlock, discarded on lock |
| Search | MiniSearch (or FlexSearch) index built in memory at unlock |
| Graph | `d3-force` simulation rendered to canvas (custom), for full control over touch, filtering, and perf; SVG acceptable ≤150 nodes |
| Testing | Vitest + Testing Library; crypto round-trip and vault-slot property tests are the priority suites |
| CI | GitHub Actions: typecheck, lint, test, build on every PR touching `dossier/` |

**Layering rule:** UI components never touch Dexie or WebCrypto directly.
`vault` (keys, lock state) → `store` (decrypted domain objects, search,
graph derivations) → `ui`. The `crypto` and `db` modules have no React
imports, so the same core can later back a sync client (T3) unchanged.

## 10. Release plan

### v1 (this scaffold grows into it)

Vault create/unlock (passphrase + biometric + PIN, auto-lock, panic lock) ·
person CRUD with quick capture and inbox triage · notes with `@mentions` ·
typed + custom relationships · interactive graph with filters and ego view ·
full-text search · follow-ups & birthdays with in-app upcoming view ·
encrypted export/import · disguise install · destroy-all-data.

### v1.x hardening

Argon2id replaces PBKDF2 (CSP gains `wasm-unsafe-eval` then) · notification
delivery where supported · quick-capture inbox triage affordance (promote
note lines to structured fields — §4.1) · chip-style tag/likes input
replacing comma-separated text · store-level render optimization if real
vaults approach the 500-person scale.

### v2 candidates

Decoy vault UI (slots already in place) · zero-knowledge multi-device sync ·
attachments beyond photos · voice capture · cluster detection · public
release prep (onboarding, docs, and the deferred legal/ethical review).

## 11. Open questions

1. Disguise depth: is a neutral name/icon enough, or should the unlock
   screen masquerade as something else entirely (calculator-style)? Leaning
   simple for v1.
2. "Me" node: implicit (created at vault setup) or optional? Graph
   queries like "how do I know X" need it; proposal is to create it during
   onboarding.
3. Shake-to-lock reliability across devices is unproven — keep the tap
   target as the guaranteed path.
4. Partial-date model for birthdays (year-optional, month-only) — schema
   supports it; UI design TBD.

---

## Appendix A — Decision log

From the requirements interview (2026-09-09):

| Topic | Decision |
|---|---|
| Storage | Local-only + encrypted export/import; no server |
| App lock | Passphrase-derived encryption + WebAuthn biometric + PIN/auto-lock (all three) |
| Audience | Author first, architected for later public release |
| Stack | React + TypeScript |
| Dossier structure | Structured fields + free notes |
| Graph edges | Typed directed edges + custom types + mention-derived links |
| Capture focus | Quick capture after meeting; in-the-moment lookup |
| Recall features | Full-text search, reminders & dates, graph queries |
| Threats prioritized | Borrowed phone, export leakage, future server (zero-knowledge by design) |
| Media | Person photos only in v1 |
| Graph UX | Core feature, fully interactive |
| Circles (§4.6) | First-class entity (not tags); many-to-many, flat; hull bubbles + gentle clustering; chips to show/hide + tap-to-focus; auto color with override; managed from the person page; empty circles persist, delete is explicit; name + color + members only; seeded in the sample cast |
| Design review round 3 | Dossier reads for lookup (Details → Follow-ups → Notes → Relationships → How you connect); group titles and settings sub-headings speak in a sentence-case voice distinct from field labels; relationship-type colour is a dot, the word is ink; two chip heights; SVG tab icons at one stroke weight; header Lock hidden on phones unless it also forgets a PIN; forward Back never leaves the app; suggestion lists pick on pointerdown (Chrome moves focus even when it's cancelled) and also on click for assistive tech; the capture bar's Save row appears only with content (holding it while focused shifted the page under a tap) |
| Add several (§4.1) | One name per line, optional “— relationship” per line; from a dossier a batch default type applies where a line has none; for one-way types the listed person is the source (“June — parent of” = June is parent of this person); existing names link rather than duplicate; unknown types fall back to the default (types are created from the relationship form only); the relationship form keeps its type and quietly refocuses after Add |
| Person fields (§4.2) | Every "pick a person" field (add relationship, mutual connections, add to circle) is one typeahead component (ranked prefix matches, keyboard combobox, create-if-missing), never a native select of the whole address book |
| Home at scale (§4.4) | Recent = last opened dossiers, stored encrypted and device-local (not in backups), padded to six with recently updated; A–Z rail scoped to the list (hidden at the top of the page), drag + roving-tabindex keyboard, accents fold to the base letter, `#` first for digits/symbols/other scripts |
| Scale + iOS (§7) | Stress crowd behind `?dev=1`, not a user feature; per-snapshot selector indexes; paged People list; batched graph painting; `visualViewport`-driven keyboard inset for bottom bars; iOS-tab install guidance (separate storage) |
| Discretion | Instant lock/panic, neutral disguise, decoy vault (designed now, built v2) |
| Looks like people (§4.2) | After a note is saved, capitalised name-shaped phrases (1–3 words) that match nobody appear as chips in the capture bar: “+ Name” creates the person, “@ Phrase → Person” links an existing one (whole name, nickname, or a first name that belongs to exactly one person); either rewrites the note to an @mention in one write so the mention edge follows. Per-chip “Not a person” and a Dismiss are session-only; nothing about declined names is stored, and old notes are never re-scanned. Heuristic only and entirely on-device: stop words, dates, acronyms, existing mentions, the dossier’s own person and ambiguous first names are skipped |
| Import contacts (§4.1) | “Import contacts…” at the People list tail reads a .vcf (2.1/3.0/4.0, as Contacts on iOS/Android/macOS export) or a .csv (Google, Outlook, or any name/e-mail/phone sheet) on the device — nothing is uploaded — and the browser’s Contact Picker where it exists. Every contact is a checkbox (new ones pre-selected, filterable), people already here by name/nickname, e-mail or phone are shown but never duplicated, in-file duplicates collapse, and one write creates the people (name, nicknames, job, employer, city/country, birthday, phone/e-mail) plus the contact’s note as a first note. Undo for a few seconds removes the import |
| Design review round 4 (Obsidian / iOS / visual personas) | Back rides the sticky app bar on a dossier; the idle capture bar is one row and grows on focus; dossier sections are spaced by the flex gap (no doubled margins) and the rest of the page steps aside while the facts form is open; “Mentioned in” sits under Notes as note content; a mention-derived relationship offers “Set type…” instead of a delete that would come straight back; the note editor shows `@Name` and restores tokens on save; Copy as text includes circles, relationships, follow-ups and mentions with ISO dates; graph names get a halo and skip when they’d overprint; search offers “+ Add” beside hits only for name-shaped queries and marks the matched term in snippets; field-group dividers sit above their titles; bars are 94% opaque with a solid fallback; hover styles only where hover exists; gold is reserved for actions (coworker edge is olive, panels lose the gold rule, known chips are neutral); circle dots are hollow like the graph rail; `/` focuses search; no “Ctrl+Enter” hint on phones. Deferred: Dynamic Type via `-apple-system-body`, per-tab scroll memory, sheets for panels, a two-column desktop dossier, collapsing the add-forms behind a “+” |
| Accessibility round (screen reader, keyboard/switch, low-vision/cognitive personas + axe) | Every screen passes axe WCAG 2.2 AA. Skip link moves focus instead of routing; the unlock screen has a main landmark; route changes land focus on the heading; focus never drops to the body after Edit/Save/Cancel, note edit/delete/promote, follow-up add/remove, relationship remove or a keyboard Save note (section headings are focus targets); the lightbox keeps Tab inside; the hidden tab bar leaves the tab order; scroll-padding keeps focused controls out from under the app bar. Chip fields are labelled by a span (a wrapping label sent clicks to the first chip’s remove button). Mention suggestions announce matches, Tab leaves the field, Enter inserts only after typing or arrowing. Search results and saves are announced from always-mounted status regions. “Set type…” is staged and applied with a button. Ctrl/Cmd+K replaces the bare “/” shortcut. Graph: circle chips are two real buttons (toggle + edit), a “See as list” text equivalent, edges and rings ≥3:1 with full-strength lines, mentions dotted / exes long-dashed / partners thick. Input and chip borders ≥3:1 (`--line-3`), `--text-4` ≥4.5:1 on every surface, forced-colors styles for tabs, dots and selections, dossier title wraps, People footer wraps at 320px, the A–Z rail thins to every other letter at large text, the capture bar rides in flow on very short viewports, the inactivity warning is 20 s and focus movement counts as activity, name-chip Undo lasts 30 s, Escape asks before discarding a typed batch. Deferred: PIN field semantics on iOS, protan-safe circle palette, visible circle names in list rows, per-tab scroll memory |
| Copy round (UX writer, plain-language editor, phone-skimmer personas) | Voice rules: the heading is the first sentence (hints never restate the title or button); placeholder or label, not both; one idea per sentence, verb first; the local-only promise is said once (create screen, Storage), not under every control; one noun per thing (person, note, circle, relationship, backup, passphrase, PIN — never vault, card, entry, biometrics, armed); confirmations are a past-tense verb with no ✓; errors start “Couldn’t…”; curly quotes. Applied across unlock/create, People, dossier empty states and hints, edit form, graph help, Settings (Backup, Restore, PIN, Face ID, Home Screen, Name & icon, Storage, Sample data, Delete), the import and batch panels, and the lock and motion banners. Kept: “Locked — everything is still here.”, the wrong-passphrase hint, the “@ links a person” tip |
| Form rules (labels and inline controls) | An inline dropdown sits at the right edge of its row, label at the left; once the label itself would wrap to two or more lines, the row goes block-level — label above, control full width (`InlineField` measures live). A label’s description renders inline in parentheses; once that would make the label wrap to two or more lines, the description drops to its own line in small subtle text (`LabelText` measures live, so the same label can be inline on a tablet and stacked on a phone). When a checkbox’s label runs to more than one line (a stacked description, or an import row’s name with detail lines under it), the box aligns with the first line, not the middle of the block |
| Hue families | Four hues, not eleven: a thin line can only tell so many colours apart, and people read family / work / social anyway. Every type belongs to a family (family `#e0607a`, work `#b8a44a`, social `#4f9cf9`, other `#9a6fd0`) and shape carries the type inside it: married 3px, partner 2.25px, parent-of a filled arrowhead, boss-of an open chevron, roommate short-dashed, friend and coworker plain; custom types cycle solid / short dash / dot-dash in label order within their family. Built-ins take their family and hue on unlock and on import (`assignTypeFamilies`); an older custom type files under “other” but keeps its colour. A new type picks a kind (Family / Work / Social / Other), not a colour. The graph rail lists types by family, then A–Z, so it reads as the legend. Kept: mentions dotted grey, former ties long-dashed, every line ≥3:1 on the canvas |
| Quiet lens | “Who have I lost touch with?” A person is quiet when nothing about them has been written for 6 months — no note, no follow-up — counting from the day they were added if there never was one; you are never quiet (`lib/quiet.ts`; follow-ups joined the per-person index). Home: one line when there’s someone (“3 people have gone quiet — no note in 6 months. See who”) opening `?quiet=1`, a view listing them longest first with “quiet 14 mo — nothing since Oct 2025” under each row and a banner with Show everyone. Graph: a “quiet” chip (a lens, off by default, remembered per session) gives quiet people a dashed ring and muted initials — the same past-tense language as a former tie; the person card says “quiet 14 mo” in place of the last-note age and See as list tags them |
| Roles on a link | A pair may carry several relationships (`Relationship` records share the pair; `pairKey` groups them), never the same type twice — `addRelationship` no-ops on a duplicate role and `addRelationships` dedupes per pair + type; `updateRelationship` changes a role’s type, former flag and dates in place (retyping onto a role the pair already has folds into it). `former`, `startDate`, `endDate` live on the edge. The built-in “ex” type is retired: on unlock and on import, `migrateExToFormer` rewrites ex edges to partner + former and drops the type once unreferenced; “ex”, “ex-partner”, “former X”, “old X” resolve via `parseRoleLabel` in batch add and the seeds. Dossier: one row per person with role chips (former: dashed, italic), “+ role” pre-fills the add form, a chip opens an inline editor (role select staged with “Change role”, Former, Since/Until in the birthday field’s formats — an end date makes the role former — Remove asks in place); Copy as text says “former partner (2019–Jun 2021)”. Graph: several roles fan out as parallel quadratic strands (hit-tested through the curve’s midpoint), former ties long-dashed with a “former” chip to hide them, the edge card retypes in place and toggles “Now former / Current again”, the person card lists every role with you. “How you connect” walks current ties first and says “Through a former tie.” when only a former one connects; mutual connections count either |
| Panels as sheets | Batch add, Import contacts and the circle editor ride a bottom sheet (`Sheet`): a grabber, a backdrop, Tab kept inside, swipe down on the grabber or tap the backdrop to dismiss, fixed above the keyboard (`--kb`) and never taller than what’s left under the app bar, scrolling inside — so the field you’re typing in never ends up under the keys. Inside a sheet a picker’s list flows in place rather than floating (a floating list would be clipped by the sheet’s scrolling). The circle editor frames its bubble above the sheet on open. Cancel is explicit and closes at once; Escape, the backdrop and a swipe ask in the footer before discarding a typed batch (no browser dialog). Desktop: the same sheet, centred, 38rem wide |
| Dynamic Type | The root font follows the system text size: `html { font: -apple-system-body }` where supported, with `text-size-adjust: 100%` so iOS doesn’t also inflate text on its own. Everything sized in rem scales with it, and the graph’s canvas text (names, initials, circle labels) reads the root size and scales too. At 150–200% nothing pushes a page wider than the phone: buttons and chips wrap their labels inside the control, action rows and the app bar wrap onto a second line, a fact’s label sits above a value that no longer fits beside it, and the graph’s chip strip keeps scrolling sideways instead. Checked by a screenshot pass at 100 / 150 / 200% over People, a dossier, the graph, Settings and a sheet |
| Two-column desktop dossier | From 64rem a dossier is two columns: what you remember and write (details, follow-ups, notes, mentions) on the left with the capture bar under it, and who they know (relationships, how you connect, photos) on the right, the header spanning both. The page and the app bar share the wider 64rem column so Back still lines up with the header. On a phone the columns are `display: contents`, so the order and the sticky capture bar are unchanged. Editing the details hides the right column too and the form takes the full width. Not sticky: a long relationships list scrolls with the page rather than trapping its tail under the fold |
| Per-tab memory | Tabs keep their place, as on iOS: the People and Settings scroll positions are recorded per route while you scroll, and a tab tap lands where you left it; the graph keeps everyone’s position, the camera and who was pinned across leaving the tab (module memory, session-only), so coming back shows the same picture instead of a fresh layout and refit. Tapping the tab you are on pops to its top (People also clears the search, as before). A dossier or a circle view always opens at the top; Back keeps the browser’s own restore. People remembers the plain list only: a position taken mid-search would land on different rows once the tab tap clears the query. `smoke20` covers it |
| 1,000-person profile (round 2) | Measured again at 1,000 people / 3,300 notes / 2,300 ties / 280 photos under 4× CPU throttling, phone viewport: unlock 4.1 s (2.5 s of it the Argon2id cost by design, the rest decrypt + search index), People list 0.6 s, search keystroke 65–160 ms to handle and ~200 ms to paint, dossier open 0.7 s, a 1,000-row CSV import 0.45 s to parse and match, 0.2 s to select all, 2.2 s to write. The graph with everyone shown (1,001 people, 2,314 ties, 67 bubbles) settled in 17 s at 10 fps and panned at 41 fps; it now settles in 12 s: a crowd over 300 people uses a coarser Barnes–Hut theta (1.2) with no repulsion beyond 800 units, and cools faster (alphaDecay 0.06, ~110 ticks) since at that size the picture is dots and bubbles. Fixed on the way: the import list’s “Select all new” only ticked the hundred rows on screen, so a big export took ten rounds of Show more; it now selects every listed contact (and “Select all shown” every filtered one). Kept as is: photo decodes during a search re-render are async and bounded (LRU 64), the dossier’s cost is React render, not the queries |
| Security review pass (§6) | Three reviewers (keys and data at rest; runtime state and leaks; untrusted input and supply chain) read the code against §6. Fixed: the record sanitizer that runs on every unlock dropped a role’s `former` and `endDate`, a type’s `family` and the `nameSuggestions` switch, so a former partner came back current after a relock (round-trip test added); a suspended page could return unlocked after hours because both auto-locks were timer-only — the moment of hiding and the last activity are now written down and coming back overdue locks at once (`pageshow` and `pagehide` too); every lock waited on the serialised write chain — the draft flush is now bounded (1.5 s for timer locks, 0.3 s for the panic button and shake; a late flush is dropped by the epoch guard); tag/like/dislike facet links put the value in the URL (`?q=`), which lands in history and address-bar suggestions — the query now rides in the store; module memory derived from records (the graph’s layout and camera, “Looks like people” declines, tab scroll positions) and `sessionStorage` graph filters are cleared on lock through a small registry (`lib/sessionCaches.ts`); the first Copy as text says once that clipboards can sync and keep history (§6.7); a note’s mention list is re-derived from its body on import and a mention links only when its id is a person here; contact files over 32 MB are refused before being read; list items are capped at 200 characters and recent ids must be ids; the backup’s extension follows the chosen disguise and the import accepts all three; a backup header must carry a numeric version; `<meta name=referrer no-referrer>`. Accepted as is: the backup header’s `format` tag names the format (the bundle is ciphertext and the tag is how the file is recognised); no AAD binds a ciphertext to its row (a write-capable forensic adversary is out of scope, §5) — photos could be swapped between people by such an adversary; a restore’s incoming self wins over the seeded “Me” (deliberate, §4.4); the graph’s `__graph` test hook exposes ids and coordinates only; “never” auto-lock stays configurable; esbuild’s dev-server advisory is dev-only and follows the next Vite major. Still open: change-passphrase (the envelope supports it; no UI yet) |
| People + dossier review (five personas) | An iOS purist, a PKM power user, a first-time layperson, a VoiceOver user and a visual designer each worked the People page and a dossier from screenshots and scripts. Fixed — capture: “Saved” shows every time (on the names card when one is up), the note box shows plain `@Name` and the note gets the link on save (`retokenize`), a space before punctuation after a mention is dropped, Escape closes the mention list and stays closed, a mention may follow a quote, dash or slash, a draft left by following a link is stashed in memory and waits for the dossier (a timer lock saves it as a note), the placeholder says “Jot a note about Priya…” until the first note, places and employers on file are never offered as people. Chrome: the note box comes first in the document (one Tab from the app bar) and is painted last; Ctrl/Cmd+K reaches the People search from any page but the graph; Back reads “‹ People” as a bare chevron; the tab bar’s Lock is set apart as an action; no top stripe on the active tab; New person is a + in the app bar, not a floating button; the search field has a clear button; the row chevron is the app bar’s stroke icon; “See on graph ›”. Dossier: Copy as text only once there is something to copy, with a status beside a button whose name never changes; Add follow-up / Link / Add to Details… / Relationship… / “People you both know — compare with”; the type select submits on Enter and Link precedes Add several… in the document; delete a note, a photo or a person and discard edits all ask in place (`DangerConfirm`), never in a browser dialog; the promote panel starts on “Choose…”; empty lines above open forms go; the empty footer is gone; add-form labels speak in the field voice; relationship rows align in a name column with “+ role” tertiary; section-head links centre on the heading; hit areas of chips and small links reach 44px; Cancel leads, Save trails; the desktop side column is 26rem, the capture bar bleeds symmetrically, the facts form keeps a 40rem measure; People groups sit 32px apart and rows get a “sample” badge. Screen reader: Back and the tab bar land focus on the new view’s heading; adding a follow-up, a link or a chip is announced; closing a role editor returns to its chip; “13d” reads “in 13 days”; the search form is a landmark; the “you” badge no longer joins the name. Sheets: a pull follows the finger, from the grabber always and from anywhere while the content is at its top. Batch add: “Otto Berg, coworker” reads the trailing part as the role. Not taken: collapsing the follow-up and relationship forms behind buttons (keep-adding was a decision), Lock out of the tab bar (reach), a sentence rendering of the path |
| Relationships as a table | The list is a three-column grid — name, roles, “+ role” — with the columns aligned across every row (each row is `display: contents` so the list itself is the grid; cells stretch to the row so the hairlines meet). A directed chip drops the subject the row already names: “parent of Marcus” on Harold’s row, “boss of Priya” when Marcus is hers |
| The installed app’s bottom edge | Every safe-area inset is read through one variable (`--sat`/`--sab`/…) rather than `env()` at each site, so a test can stand in a home indicator — `env()` is always 0 in a headless browser, which is why the installed app’s bottom went unchecked. Fixed with it: the tab bar was 56px of content over a 34px strip that took no taps, so a thumb landing low on a tab did nothing; the tabs now run to the screen’s bottom edge and pad their labels above the inset, as a native tab bar does. The bar is the native 49px plus the inset (was 7px taller), and the Lock divider is a hairline inset from both edges instead of a border cut short above the indicator. `smoke21` measures all of it against a simulated 34px inset |
| Filters can’t strand you | “Nothing to draw” is a fact about the vault, never about the filters. The graph’s bare state (which replaces the chip rail with “No relationships yet”) reads the unfiltered records, so switching every circle and every type off leaves the canvas, the rail and its sticky “N hidden · Show all” chip in place — before, it swapped in a claim that wasn’t true and took away the one control that could undo it, and the filters persist per session, so the graph stayed empty on every return. `smoke10` writes an “everything off” filter set into the session and checks the canvas, the rail and the way back all survive it |
| A passkey that can’t open the vault says so | Face ID succeeding and nothing happening was the app’s worst failure, and every way biometric unlock could fail produced it: the unlock button caught *every* exception as “you dismissed the sheet” and cleared the message, so a wrap that no longer matched (`unwrapDek` throwing `OperationError`) looked exactly like changing your mind. Unlock now returns a reason rather than a boolean — cancelled, no PRF from this browser, or stale — and only a real cancel is silent. A stale passkey (the vault restored or re-created since enrolling, so the PRF opens the wrap but the DEK matches no slot, or the wrap won’t open at all) retires its own enrollment the way a stale PIN disarms itself, rather than sitting on the unlock screen failing forever, and says to open with the passphrase and turn Face ID on again. Unlock also asks for the PRF with `eval` when there is a single enrollment (the normal case — Settings offers one switch) instead of `evalByCredential`, which is the newer and less widely implemented half of the extension; enrollment always used `eval`, so the two now match. `smoke23` drives the whole thing against Chromium’s virtual authenticator with `hasPrf`: enrol, lock, open with the passkey, then break the wrap and check the screen says something, drops the enrollment and still opens on the passphrase — confirmed to fail against the unfixed build, where nothing at all appeared |
| Chips isolate rather than subtract | Tapping a circle or a relationship type on a full rail leaves that one on and switches the rest of its group off, because “just my family” is what you actually want from a chip nine times in ten — subtracting one tie type from twelve was never the question. After that taps are ordinary: an off chip comes back alongside, an on chip drops out, and the tap that would empty a group puts every chip in it back instead, so a rail can never go dark and the reset is always one tap on the last chip standing. Circles and types are separate pools — isolating a circle leaves every type on, or you’d get the circle’s people with no lines between them; `mentions`, `former` and `quiet` stay plain lenses over whatever is showing. A circle chip narrows the people, not just the bubbles: “only the climbing crew” takes the rest of the vault off the screen, the way the `?circle=` focus already did for one circle, and two circles showing means the union of their members. The rail keeps listing every circle in scope while you narrow (it reads the pre-narrowing set), each chip’s title and label name what the next tap will do (“Show only work”, “Add family back”, “Show all again”), and a filter set that leaves nobody on screen says so with a Show all beside it rather than a blank canvas. Isolating circles re-fits the camera the way ego ↔ everyone already does, and the sticky chip’s measured width becomes the strip’s scroll padding so the chip you just tapped stops clear of it rather than half underneath. `lib/chipIsolate.ts` holds the rule and its table of cases; `smoke22` walks them on the rail |
| Graph review round (network-viz designer, Obsidian graph user, iOS designer, visual designer, interaction designer) | The graph now answers touch: tapping a person lights their neighbourhood (full-colour edges a stroke heavier, neighbours named whatever the zoom, a bright ring and halo on the subject) and fades everyone else; the how-you-connect path dims the rest the same way; the desktop pointer previews the same neighbourhood; a second tap on the subject opens their page. Growing the visible set (ego → everyone, 1 → 2 hops) used to leave newcomers on d3’s origin spiral under a barely-warm simulation — a hex grid at 315 people; newcomers now start beside a placed neighbour with scatter, the run heats with the share of new people (and to at least 0.5 on any view change), and every view change re-fits the camera (eased 250 ms, composing with an in-flight move). Rim gravity is aspect-aware so a phone canvas fills its height; link length follows the tie (household 60, same circle 72, other 100, mentions 130); circle pull 0.34·α. Quieter palette: resting edges wear a muted type colour (mixed 38% toward the warm neutral, lightened until ≥3:1 on the canvas; chips keep the full colour as the legend), 1.25px; node fill `#232120`, 1px ring; names in `--text-2` at 12px on a canvas-coloured halo, ranked (subject, you, focus, lit, hubs) and dodging nodes and each other, below then above; circle names in small caps, toned toward the caption grey, hung off the bubble’s top edge (left, middle, right, then below, then climbing) and never over a person or their name; hull fill 0.07 / outline 0.32, fills skipped past six bubbles; gold is yours alone (the ego focus wears a bright ring). Phone chrome: the canvas bleeds edge to edge with no frame, the chip strip bleeds and snaps, chips are 32px at weight 500, the help sentence became a one-time in-canvas hint (the copy stays as `aria-describedby`), “See as list” is a list button in a bottom-right 44pt capsule with centre-on-me and fit (+/− only where a pointer can’t pinch), and the list opens as an overlay dialog. Strip order: focus/path chips, Find…, “N hidden · Show all” (sticky), circles, types, mentions. Find… opens the person picker over the canvas and centres on the pick (or opens their world if they’re off-graph). Gestures: on touch a finger that lands on a person pans until held 350 ms, then picks them up (haptic where available) — a mouse picks up at once; a dragged person stays pinned (tick on the ring, Unpin on their card) and only the neighbourhood eases (alphaTarget 0.1); double-tap zooms in there, two-finger tap zooms out; with a card open a tap anywhere else only dismisses; a pointer that went down elsewhere (a picker row) is never a canvas tap. A bubble tap opens a light card (name, count, Only this circle, Edit…); the editor sits behind Edit… and the chip’s ✎. Remove and Delete ask in the row, never in a browser dialog. The person card says how you know them (type, “mentioned in your notes”, or “2 hops, via Priya”), their circles, link count and last-note age, and offers How you connect. The card nudges the view so the person it describes stays visible. Level of detail follows density like map markers: people per 100×100 css px of canvas (those in view) picks full / mid / low; at mid the least-connected 40% draw as small dots, at low everyone outside the best-connected quarter (never you, the focus, a card’s subject, a lit neighbour or a path); dots have no ring, initials or name, a link to a dot is faint and 1px, and at low a link between two dots is dropped; names are screen-sized (12px at every zoom) with a budget of ~1.1 per cell, the most important first, dodging only people drawn in full at reduced detail. Zooming in thins the view and brings people, links and names back. Deferred: inertia after a pan, a 4-hue relationship family palette with shape inside the family, screen-size clamped discs, a “quiet” time lens, the circle editor as a keyboard-aware sheet. Find moved out of the strip afterwards: a magnifier in the app bar on the graph route (the strip is the legend, Find is navigation) that opens the picker beneath the bar, Ctrl/Cmd+K opens it as it focuses search on People, Escape closes |
| Platform | Mobile-first, desktop works |
| Legal/ethics section | Skipped for now (revisit before public release) |
| Deliverable | This document + scaffolded React/TS PWA |
