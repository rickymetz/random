/**
 * Persistence layer (REQUIREMENTS.md §6.1, §6.6).
 *
 * IndexedDB holds only ciphertext. Vault slots carry the KDF salt/params,
 * the wrapped DEK, and the vault's data prefix SEALED under the DEK, so
 * the raw database never maps a slot to its records. Record rows are
 * `{id, iv, blob}` with no timestamps, kinds, or sizes beyond the
 * unavoidable ciphertext length — a forensic dump learns row count and
 * per-row size, nothing else.
 */
import Dexie, { type Table } from 'dexie'
import type { KdfParams } from './crypto'

export interface VaultSlotRow {
  /** Random slot id; carries no meaning. */
  id: string
  salt: Uint8Array
  kdfParams: KdfParams
  wrappedDekIv: Uint8Array
  wrappedDek: Uint8Array
  /** The vault's record-key prefix, AES-GCM sealed under the DEK. */
  prefixIv: Uint8Array
  prefixCt: Uint8Array
  schemaVersion: number
}

export interface EncryptedRecordRow {
  /** `${dataPrefix}:${uuid}` — reveals vault membership only via the opaque prefix. */
  id: string
  iv: Uint8Array
  blob: Uint8Array
}

/**
 * A biometric (WebAuthn PRF) enrollment: the DEK wrapped under a key
 * derived from the credential's PRF output. Carries NO reference to a
 * vault slot — unlock resolves the vault by trying the sealed prefixes,
 * same as passphrase unlock — and NO timestamps (§5 residual-metadata
 * rule). That enrollments exist, and how many, is observable.
 */
export interface AuthRow {
  /** Credential id, hex — doubles as the row key. */
  id: string
  prfSalt: Uint8Array
  hkdfSalt: Uint8Array
  wrappedDekIv: Uint8Array
  wrappedDek: Uint8Array
  /** WebAuthn transport hints for cleaner unlock prompts. */
  transports?: string[]
}

/** Encrypted binary payloads (photos) — same shape as records. */
export interface EncryptedBlobRow {
  /** `${dataPrefix}:${uuid}` like record rows. */
  id: string
  iv: Uint8Array
  blob: Uint8Array
}

class DossierDb extends Dexie {
  slots!: Table<VaultSlotRow, string>
  records!: Table<EncryptedRecordRow, string>
  auth!: Table<AuthRow, string>
  blobs!: Table<EncryptedBlobRow, string>

  constructor() {
    // Neutral database name: part of the disguise posture (§6.5).
    super('ledger')
    this.version(1).stores({
      slots: 'id',
      records: 'id',
    })
    this.version(2).stores({
      auth: 'id',
    })
    // Binary payloads live apart from JSON records so the record loader
    // never tries to JSON-parse an image.
    this.version(3).stores({
      blobs: 'id',
    })
  }
}

export const db = new DossierDb()

/**
 * Full local wipe — backs the "destroy all data" action (§6.7): the
 * database, the service-worker caches, and the SW registration itself,
 * so nothing recoverable remains in browser storage.
 */
export async function destroyAllData(): Promise<void> {
  await db.delete()
  try {
    if ('caches' in globalThis) {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    }
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(registrations.map((r) => r.unregister()))
  } catch {
    // Cache/SW cleanup is best-effort; the vault data itself is gone.
  }
}
