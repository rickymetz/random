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
  ex, roommate, …) with direction where meaningful (parent→child).
- **Custom relationship types:** users can define their own types with a
  label, color, and directionality. Custom types are first-class in filters
  and rendering.
- **Mention-derived links:** an `@mention` of person B in person A's notes
  automatically creates (or reinforces) an untyped "mentioned" edge A→B.
  These render distinctly (dashed) and can be upgraded to a typed edge in
  one tap. Deleting the mention text removes the derived edge unless it was
  upgraded.
- Edges may carry an optional free-text note ("met at Dana's wedding") and
  a start date.

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
  list renders in pages of 60 (sentinel + "Show more"); the graph
  batches draw calls by style, cools faster and paints every other tick
  above 150 nodes.
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
| Scale + iOS (§7) | Stress crowd behind `?dev=1`, not a user feature; per-snapshot selector indexes; paged People list; batched graph painting; `visualViewport`-driven keyboard inset for bottom bars; iOS-tab install guidance (separate storage) |
| Discretion | Instant lock/panic, neutral disguise, decoy vault (designed now, built v2) |
| Platform | Mobile-first, desktop works |
| Legal/ethics section | Skipped for now (revisit before public release) |
| Deliverable | This document + scaffolded React/TS PWA |
