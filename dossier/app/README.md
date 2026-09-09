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

Still to build: photos/avatars, biometric (WebAuthn PRF) and PIN unlock,
inactivity auto-lock timer, disguise selection, graph queries (mutual
connections, paths), notifications, Argon2id, decoy vault UI (v2).

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
