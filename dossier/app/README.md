# Dossier — app scaffold

React + TypeScript + Vite PWA scaffold for Dossier. The product spec and
security architecture live in [`../REQUIREMENTS.md`](../REQUIREMENTS.md) —
read that first; this codebase is organized around its sections.

## What's real vs. stubbed

Real already:

- **Crypto core** (`src/lib/crypto.ts`): AES-256-GCM record encryption,
  DEK/KEK envelope, PBKDF2 key derivation (Argon2id planned — §6.2).
- **Vault slots** (`src/lib/vault.ts`, `src/lib/db.ts`): decoy-ready slot
  layout, ciphertext-only IndexedDB persistence, dummy slot on creation.
- **Lock behavior**: unlock gate around all routes, one-tap lock,
  auto-lock on backgrounding, in-memory-only decrypted state.
- **Dossiers** (`src/pages/PersonPage.tsx`): structured fields + free
  notes with `@mention` tokens, follow-ups, quick capture.
- **Relationships**: typed directed edges, custom types, mention-derived
  edges that upgrade to explicit ones (`src/store/vaultStore.ts`).
- **Graph** (`src/pages/GraphPage.tsx`): d3-force canvas with pan, zoom,
  pinch, node drag, type filters, ego view (`?focus=`), tap-through.
- **Search** (`src/lib/search.ts`): in-memory MiniSearch over names,
  fields, tags, and note text; upcoming strip for birthdays/follow-ups.
- **Encrypted export/import** (`src/lib/export.ts`): passphrase-keyed
  bundles, the only way data leaves the device.
- Tests: crypto round-trip, vault slots, mentions, export, and store
  behaviors (mention-edge sync, cascade delete, lock/unlock).

Hardened in review round 0 (multi-persona review, ~60 fixes): import
sanitization (a crafted backup can't brick the vault), sealed slot→prefix
mapping and constant-work unlock (dummy slot is unlinkable), non-extractable
DEK, lock-epoch guards + serialized writes (no plaintext after a racing
lock), export verified against the open vault's own slot, KDF bounds on
untrusted headers, corrupted-row tolerance, cache+SW wipe on destroy,
date-parse round-trip + validation, reciprocal mention edges, overdue
follow-ups, PWA icons + iOS metas, SW auto-update, persistent-storage
surfacing + backup nag, graph layout/viewport persistence, pinch anchoring,
culled rAF rendering, peek cards + edge editing, keyboard graph controls.

Slice 2 (unlock methods, §6.3): biometric unlock via WebAuthn PRF
(`lib/webauthn.ts` — passkey with the PRF extension wraps the DEK; no
slot linkage stored; passphrase required to enroll), a session PIN
(`lib/pin.ts` — memory-only wrap, 5 attempts then passphrase), a
configurable inactivity auto-lock and background grace period stored in
the encrypted settings record, and an unlock screen that offers
PIN/biometric with passphrase fallback.

Slice 3 (photos, §4.1/§8): encrypted person photos — client-side
downscale/re-encode (EXIF stripped) in `lib/image.ts`, a separate
ciphertext `blobs` table so binary data never touches the JSON record
loader, an in-memory object-URL cache cleared on lock
(`lib/photoCache.ts`), avatars on the person page, people list, and
graph nodes, a per-person gallery with avatar promotion, blob cascade on
person delete, and export format v2 carrying photos in backups.

Still to build: disguise selection, graph queries (mutual connections,
paths), notifications, Argon2id, inbox triage affordance, chip-style tag
input, decoy vault UI (v2).

## Commands

```sh
npm install
npm run dev        # local dev server
npm run test       # vitest (crypto + vault suites)
npm run typecheck
npm run build      # tsc + vite build with PWA manifest/service worker
```

## Layering rule (§9)

UI never touches Dexie or WebCrypto directly:
`lib/crypto` + `lib/db` → `lib/vault` → `store/` → `pages/`. The lib layer
has no React imports so it can later back a zero-knowledge sync client
unchanged.
