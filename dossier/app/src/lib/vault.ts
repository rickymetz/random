/**
 * Vault lifecycle (REQUIREMENTS.md §6.2, §6.3, §6.6).
 *
 * A vault is a slot row (salt + kdf params + wrapped DEK + opaque data
 * prefix) plus the encrypted records under that prefix. Unlock tries the
 * passphrase against every slot; the one that unwraps is the vault you get,
 * so a wrong passphrase and a different vault's passphrase are
 * indistinguishable. Creation always writes an extra dummy slot of random
 * bytes so a single-vault store doesn't prove there is no decoy.
 */
import {
  DEFAULT_KDF_PARAMS,
  decryptJson,
  deriveKek,
  encryptJson,
  generateDek,
  randomBytes,
  unwrapDek,
  wrapDek,
} from './crypto'
import { db, type VaultSlotRow } from './db'
import type { DomainRecord } from './models'

export interface UnlockedVault {
  slotId: string
  dataPrefix: string
  dek: CryptoKey
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function makeDummySlot(): VaultSlotRow {
  return {
    id: toHex(randomBytes(16)),
    salt: randomBytes(16),
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedDekIv: randomBytes(12),
    // Same length as a real wrapped 256-bit key (32 bytes + 16-byte GCM tag).
    wrappedDek: randomBytes(48),
    dataPrefix: toHex(randomBytes(8)),
    schemaVersion: 1,
  }
}

export async function vaultExists(): Promise<boolean> {
  return (await db.slots.count()) > 0
}

export async function createVault(passphrase: string): Promise<UnlockedVault> {
  const salt = randomBytes(16)
  const kek = await deriveKek(passphrase, salt)
  const dek = await generateDek()
  const wrapped = await wrapDek(dek, kek)
  const slot: VaultSlotRow = {
    id: toHex(randomBytes(16)),
    salt,
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedDekIv: wrapped.iv,
    wrappedDek: wrapped.ciphertext,
    dataPrefix: toHex(randomBytes(8)),
    schemaVersion: 1,
  }
  await db.slots.bulkAdd([slot, makeDummySlot()])
  return { slotId: slot.id, dataPrefix: slot.dataPrefix, dek }
}

/** Returns null on failure — deliberately silent about *why* (§6.6). */
export async function unlockVault(passphrase: string): Promise<UnlockedVault | null> {
  const slots = await db.slots.toArray()
  for (const slot of slots) {
    try {
      const kek = await deriveKek(passphrase, slot.salt, slot.kdfParams)
      const dek = await unwrapDek(
        { iv: slot.wrappedDekIv, ciphertext: slot.wrappedDek },
        kek,
      )
      return { slotId: slot.id, dataPrefix: slot.dataPrefix, dek }
    } catch {
      // Not this slot (or wrong passphrase) — indistinguishable by design.
    }
  }
  return null
}

export async function saveRecord(vault: UnlockedVault, record: DomainRecord): Promise<void> {
  const { iv, blob } = await encryptJson(vault.dek, record)
  await db.records.put({
    id: `${vault.dataPrefix}:${record.id}`,
    iv,
    blob,
    updatedAt: Date.now(),
  })
}

export async function loadAllRecords(vault: UnlockedVault): Promise<DomainRecord[]> {
  const rows = await db.records
    .where('id')
    .startsWith(`${vault.dataPrefix}:`)
    .toArray()
  return Promise.all(
    rows.map((row) => decryptJson<DomainRecord>(vault.dek, { iv: row.iv, blob: row.blob })),
  )
}

export async function deleteRecord(vault: UnlockedVault, recordId: string): Promise<void> {
  await db.records.delete(`${vault.dataPrefix}:${recordId}`)
}
