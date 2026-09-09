import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import type { Person } from './models'
import {
  createVault,
  loadAllRecords,
  saveRecord,
  unlockVault,
  vaultExists,
} from './vault'

function makePerson(name: string): Person {
  return {
    kind: 'person',
    id: crypto.randomUUID(),
    displayName: name,
    nicknames: [],
    likes: [],
    dislikes: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('vault', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
  })

  it('creates, locks, and unlocks with records intact', async () => {
    const vault = await createVault('open sesame')
    await saveRecord(vault, makePerson('Ada'))
    await saveRecord(vault, makePerson('Grace'))

    const reopened = await unlockVault('open sesame')
    expect(reopened).not.toBeNull()
    expect(reopened!.dataPrefix).toBe(vault.dataPrefix)
    const { records, corrupted } = await loadAllRecords(reopened!)
    expect(corrupted).toBe(0)
    expect(records.map((r) => (r as Person).displayName).sort()).toEqual(['Ada', 'Grace'])
  })

  it('returns null (not an error) for a wrong passphrase', async () => {
    await createVault('open sesame')
    expect(await unlockVault('open sesamee')).toBeNull()
  })

  it('always writes a dummy slot so slot count reveals nothing', async () => {
    await createVault('open sesame')
    expect(await vaultExists()).toBe(true)
    expect(await db.slots.count()).toBe(2)
  })

  it('never maps a slot to its records in cleartext', async () => {
    const vault = await createVault('open sesame')
    await saveRecord(vault, makePerson('Ada'))
    // The record keys carry the prefix, but no slot row may contain it —
    // otherwise a forensic dump identifies the dummy slot (§6.6).
    const slots = await db.slots.toArray()
    for (const slot of slots) {
      const dump = JSON.stringify(slot, (_k, v) =>
        v instanceof Uint8Array ? Array.from(v).join(',') : v,
      )
      expect(dump).not.toContain(vault.dataPrefix)
    }
  })

  it('skips a corrupted row instead of bricking unlock', async () => {
    const vault = await createVault('open sesame')
    await saveRecord(vault, makePerson('Ada'))
    await db.records.put({
      id: `${vault.dataPrefix}:${crypto.randomUUID()}`,
      iv: crypto.getRandomValues(new Uint8Array(12)),
      blob: crypto.getRandomValues(new Uint8Array(64)),
    })

    const reopened = await unlockVault('open sesame')
    const { records, corrupted } = await loadAllRecords(reopened!)
    expect(corrupted).toBe(1)
    expect(records).toHaveLength(1)
  })

  it('persists only ciphertext', async () => {
    const vault = await createVault('open sesame')
    await saveRecord(vault, makePerson('Ada Lovelace'))

    const rows = await db.records.toArray()
    expect(rows).toHaveLength(1)
    const raw = String.fromCharCode(...rows[0].blob)
    expect(raw).not.toContain('Ada')
    expect(raw).not.toContain('person')
    // No cleartext timestamps on rows (activity-timeline leak).
    expect(Object.keys(rows[0]).sort()).toEqual(['blob', 'id', 'iv'])
  })
}, 60_000)
