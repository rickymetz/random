/**
 * Vault lifecycle (REQUIREMENTS.md §6.2, §6.3, §6.6).
 *
 * A vault is a slot row (salt + kdf params + wrapped DEK + ENCRYPTED data
 * prefix) plus the encrypted records under that prefix. The prefix is
 * ciphertext under the DEK, so an examiner of the raw database cannot map
 * a slot to its records — the slot that owns the visible rows and the
 * dummy slot are indistinguishable. Unlock derives a KEK and tries the
 * unwrap against EVERY slot before answering, so latency does not reveal
 * which slot (if any) matched. Creation always writes an extra dummy slot
 * of random bytes so a single-vault store doesn't prove there is no decoy.
 *
 * Known residual metadata (documented in REQUIREMENTS.md §5): total row
 * count and per-row ciphertext size remain observable; rows carry no
 * timestamps or type information in cleartext.
 */
import {
  DEFAULT_KDF_PARAMS,
  decryptBlob,
  decryptJson,
  deriveKek,
  encryptBlob,
  encryptJson,
  generateDekBytes,
  importDek,
  randomBytes,
  unwrapDek,
  validateKdfParams,
  wipe,
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

// prefixCt is AES-GCM over 8 prefix bytes: 8 + 16-byte tag.
const PREFIX_CT_LENGTH = 24
// wrappedDek is AES-GCM over 32 key bytes: 32 + 16-byte tag.
const WRAPPED_DEK_LENGTH = 48

function makeDummySlot(): VaultSlotRow {
  return {
    id: toHex(randomBytes(16)),
    salt: randomBytes(16),
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedDekIv: randomBytes(12),
    wrappedDek: randomBytes(WRAPPED_DEK_LENGTH),
    prefixIv: randomBytes(12),
    prefixCt: randomBytes(PREFIX_CT_LENGTH),
    schemaVersion: 1,
  }
}

export async function vaultExists(): Promise<boolean> {
  return (await db.slots.count()) > 0
}

export async function createVault(passphrase: string): Promise<UnlockedVault> {
  const salt = randomBytes(16)
  const kek = await deriveKek(passphrase, salt)
  const rawDek = generateDekBytes()
  const wrapped = await wrapDek(rawDek, kek)
  const dek = await importDek(rawDek)
  wipe(rawDek)

  const prefixBytes = randomBytes(8)
  const dataPrefix = toHex(prefixBytes)
  const prefixSealed = await encryptBlob(dek, prefixBytes)

  const slot: VaultSlotRow = {
    id: toHex(randomBytes(16)),
    salt,
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedDekIv: wrapped.iv,
    wrappedDek: wrapped.ciphertext,
    prefixIv: prefixSealed.iv,
    prefixCt: prefixSealed.blob,
    schemaVersion: 1,
  }
  await db.slots.bulkAdd([slot, makeDummySlot()])
  return { slotId: slot.id, dataPrefix, dek }
}

/**
 * Returns null on failure — deliberately silent about *why* (§6.6).
 * Every slot is tried to completion regardless of earlier matches, so
 * unlock latency is the same for a hit on any slot and for a miss.
 */
export async function unlockVault(passphrase: string): Promise<UnlockedVault | null> {
  const slots = await db.slots.toArray()
  let result: UnlockedVault | null = null
  for (const slot of slots) {
    try {
      const kek = await deriveKek(passphrase, slot.salt, validateKdfParams(slot.kdfParams))
      const rawDek = await unwrapDek(
        { iv: slot.wrappedDekIv, ciphertext: slot.wrappedDek },
        kek,
      )
      const dek = await importDek(rawDek)
      wipe(rawDek)
      const prefixBytes = await decryptBlob(dek, { iv: slot.prefixIv, blob: slot.prefixCt })
      result ??= { slotId: slot.id, dataPrefix: toHex(prefixBytes), dek }
    } catch {
      // Not this slot (or wrong passphrase) — indistinguishable by design.
    }
  }
  return result
}

export async function saveRecord(vault: UnlockedVault, record: DomainRecord): Promise<void> {
  const { iv, blob } = await encryptJson(vault.dek, record)
  await db.records.put({ id: `${vault.dataPrefix}:${record.id}`, iv, blob })
}

export async function saveRecords(
  vault: UnlockedVault,
  records: DomainRecord[],
): Promise<void> {
  const rows = await Promise.all(
    records.map(async (record) => {
      const { iv, blob } = await encryptJson(vault.dek, record)
      return { id: `${vault.dataPrefix}:${record.id}`, iv, blob }
    }),
  )
  await db.records.bulkPut(rows)
}

export interface LoadResult {
  records: DomainRecord[]
  /** Rows that failed to decrypt or parse — skipped, not fatal (§6.1). */
  corrupted: number
}

export async function loadAllRecords(vault: UnlockedVault): Promise<LoadResult> {
  const rows = await db.records
    .where('id')
    .startsWith(`${vault.dataPrefix}:`)
    .toArray()
  const settled = await Promise.allSettled(
    rows.map((row) => decryptJson<DomainRecord>(vault.dek, { iv: row.iv, blob: row.blob })),
  )
  const records: DomainRecord[] = []
  let corrupted = 0
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') records.push(outcome.value)
    else corrupted += 1
  }
  return { records, corrupted }
}

export async function deleteRecords(
  vault: UnlockedVault,
  recordIds: string[],
): Promise<void> {
  await db.records.bulkDelete(recordIds.map((id) => `${vault.dataPrefix}:${id}`))
}
