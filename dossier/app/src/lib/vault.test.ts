import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import type { Person } from './models'
import { createVault, loadAllRecords, saveRecord, unlockVault, vaultExists } from './vault'

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
    const records = await loadAllRecords(reopened!)
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

  it('persists only ciphertext', async () => {
    const vault = await createVault('open sesame')
    await saveRecord(vault, makePerson('Ada Lovelace'))

    const rows = await db.records.toArray()
    expect(rows).toHaveLength(1)
    const raw = String.fromCharCode(...rows[0].blob)
    expect(raw).not.toContain('Ada')
    expect(raw).not.toContain('person')
  })
}, 30_000)
