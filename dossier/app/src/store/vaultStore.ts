/**
 * In-memory decrypted state (REQUIREMENTS.md §6.1, §9).
 *
 * Everything here exists only while unlocked. `lock()` is the panic path
 * too: it drops the DEK reference and all decrypted records synchronously.
 * Nothing in this store is ever persisted directly — writes go through
 * vault.saveRecord and are mirrored here.
 */
import { create } from 'zustand'
import type { DomainRecord, Person, Relationship, RelationshipType } from '../lib/models'
import {
  createVault,
  loadAllRecords,
  unlockVault,
  vaultExists,
  saveRecord,
  type UnlockedVault,
} from '../lib/vault'

interface VaultState {
  status: 'unknown' | 'no-vault' | 'locked' | 'unlocked'
  vault: UnlockedVault | null
  records: Map<string, DomainRecord>

  init: () => Promise<void>
  create: (passphrase: string) => Promise<void>
  unlock: (passphrase: string) => Promise<boolean>
  lock: () => void
  upsert: (record: DomainRecord) => Promise<void>
}

export const useVaultStore = create<VaultState>((set, get) => ({
  status: 'unknown',
  vault: null,
  records: new Map(),

  init: async () => {
    set({ status: (await vaultExists()) ? 'locked' : 'no-vault' })
  },

  create: async (passphrase) => {
    const vault = await createVault(passphrase)
    set({ status: 'unlocked', vault, records: new Map() })
  },

  unlock: async (passphrase) => {
    const vault = await unlockVault(passphrase)
    if (!vault) return false
    const records = new Map((await loadAllRecords(vault)).map((r) => [r.id, r]))
    set({ status: 'unlocked', vault, records })
    return true
  },

  lock: () => {
    set({ status: 'locked', vault: null, records: new Map() })
  },

  upsert: async (record) => {
    const { vault, records } = get()
    if (!vault) throw new Error('locked')
    await saveRecord(vault, record)
    const next = new Map(records)
    next.set(record.id, record)
    set({ records: next })
  },
}))

export function selectPeople(records: Map<string, DomainRecord>): Person[] {
  return [...records.values()].filter((r): r is Person => r.kind === 'person')
}

export function selectRelationships(records: Map<string, DomainRecord>): Relationship[] {
  return [...records.values()].filter((r): r is Relationship => r.kind === 'relationship')
}

export function selectRelationshipTypes(
  records: Map<string, DomainRecord>,
): RelationshipType[] {
  return [...records.values()].filter(
    (r): r is RelationshipType => r.kind === 'relationshipType',
  )
}
