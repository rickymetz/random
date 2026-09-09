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
- Tests for the crypto round-trip and vault slot behavior.

Stubbed (pages exist, features don't): dossier detail view, notes with
@mentions, relationships, the graph canvas, search index, follow-ups,
encrypted export/import, biometric/PIN unlock, disguise selection.

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
