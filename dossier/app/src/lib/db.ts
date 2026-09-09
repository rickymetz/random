/**
 * Persistence layer (REQUIREMENTS.md §6.1, §6.6).
 *
 * IndexedDB holds only ciphertext. Vault slots carry the KDF salt/params and
 * the wrapped DEK; `records` holds every domain object as an opaque
 * AES-GCM blob namespaced by an opaque per-vault prefix, so a future decoy
 * vault's records are indistinguishable from the primary's.
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
  /** Opaque prefix namespacing this vault's rows in `records`. */
  dataPrefix: string
  schemaVersion: number
}

export interface EncryptedRecordRow {
  /** `${dataPrefix}:${uuid}` — reveals vault membership only via the opaque prefix. */
  id: string
  /** Record kind is inside the ciphertext; rows are shape-indistinguishable. */
  iv: Uint8Array
  blob: Uint8Array
  updatedAt: number
}

class DossierDb extends Dexie {
  slots!: Table<VaultSlotRow, string>
  records!: Table<EncryptedRecordRow, string>

  constructor() {
    // Neutral database name: part of the disguise posture (§6.5).
    super('ledger')
    this.version(1).stores({
      slots: 'id',
      records: 'id, updatedAt',
    })
  }
}

export const db = new DossierDb()

/** Full local wipe — backs the "destroy all data" action (§6.7). */
export async function destroyAllData(): Promise<void> {
  await db.delete()
}
