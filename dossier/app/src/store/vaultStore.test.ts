import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../lib/db'
import { mentionToken } from '../lib/mentions'
import {
  selectNotes,
  selectRelationships,
  selectRelationshipTypes,
  useVaultStore,
} from './vaultStore'

const store = () => useVaultStore.getState()

describe('vault store', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  it('seeds built-in relationship types on create', () => {
    const types = selectRelationshipTypes(store().records)
    expect(types.some((t) => t.label === 'mentioned' && t.builtIn)).toBe(true)
    expect(types.some((t) => t.label === 'friend')).toBe(true)
  })

  it('derives a mention edge from a note and removes it with the note', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    await store().saveNote(ada.id, `Lunch with ${mentionToken(bob)}`)

    let edges = selectRelationships(store().records)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ fromId: ada.id, toId: bob.id, origin: 'mention' })

    const note = selectNotes(store().records, ada.id)[0]
    await store().removeNote(note.id)
    edges = selectRelationships(store().records)
    expect(edges).toHaveLength(0)
  })

  it('creates reciprocal mention edges when both people mention each other', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    await store().saveNote(ada.id, `Lunch with ${mentionToken(bob)}`)
    await store().saveNote(bob.id, `Great lunch with ${mentionToken(ada)}`)

    const edges = selectRelationships(store().records)
    expect(edges).toHaveLength(2)
    expect(edges.some((e) => e.fromId === ada.id && e.toId === bob.id)).toBe(true)
    expect(edges.some((e) => e.fromId === bob.id && e.toId === ada.id)).toBe(true)

    // Adding another note to Ada must not disturb Bob's edge.
    await store().saveNote(ada.id, `Again with ${mentionToken(bob)}`)
    expect(selectRelationships(store().records)).toHaveLength(2)
  })

  it('upgrading to an explicit edge replaces the mention edge and survives note deletion', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    await store().saveNote(ada.id, `Lunch with ${mentionToken(bob)}`)

    const friend = selectRelationshipTypes(store().records).find((t) => t.label === 'friend')!
    await store().addRelationship(ada.id, bob.id, friend.id)

    let edges = selectRelationships(store().records)
    expect(edges).toHaveLength(1)
    expect(edges[0].origin).toBe('explicit')

    const note = selectNotes(store().records, ada.id)[0]
    await store().removeNote(note.id)
    edges = selectRelationships(store().records)
    expect(edges).toHaveLength(1)
  })

  it('re-derives the mention edge when an upgraded edge is removed from either page', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    await store().saveNote(ada.id, `Lunch with ${mentionToken(bob)}`)
    const friend = selectRelationshipTypes(store().records).find((t) => t.label === 'friend')!
    // Upgrade from BOB's side: the explicit edge is Bob→Ada, while the
    // mention lives in Ada's note.
    await store().addRelationship(bob.id, ada.id, friend.id)
    const explicit = selectRelationships(store().records)[0]

    await store().removeRelationship(explicit.id)
    const edges = selectRelationships(store().records)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ fromId: ada.id, toId: bob.id, origin: 'mention' })
  })

  it('reuses an existing custom type instead of duplicating the label', async () => {
    const first = await store().addRelationshipType('mentor', '#123456', false)
    const second = await store().addRelationshipType('Mentor', '#654321', true)
    expect(second.id).toBe(first.id)
    expect(
      selectRelationshipTypes(store().records).filter(
        (t) => t.label.toLowerCase() === 'mentor',
      ),
    ).toHaveLength(1)
  })

  it('removing a person cascades and rewrites dangling mentions in other notes', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    await store().saveNote(ada.id, `Lunch with ${mentionToken(bob)} at the pier`)
    await store().addFollowUp(bob.id, 'ask about the boat')

    await store().removePerson(bob.id)
    const records = [...store().records.values()]
    expect(records.some((r) => r.kind === 'person' && r.id === bob.id)).toBe(false)
    expect(records.some((r) => r.kind === 'followUp')).toBe(false)
    expect(records.some((r) => r.kind === 'relationship')).toBe(false)
    // Ada's note survives with the token flattened to a plain name.
    const note = selectNotes(store().records, ada.id)[0]
    expect(note.body).toBe('Lunch with Bob at the pier')
    expect(note.mentions).toEqual([])
  })

  it('a lock racing an in-flight write leaves the store empty (no plaintext after lock)', async () => {
    const ada = await store().addPerson('Ada')
    const pending = store().saveNote(ada.id, 'secret rendezvous details')
    store().lock()
    // The write must not throw and must not repopulate memory — the panic
    // path wins. (Whether the ciphertext reached disk is timing-dependent
    // and safe either way.)
    await expect(pending).resolves.toBeUndefined()
    expect(store().records.size).toBe(0)
    expect(store().vault).toBeNull()
    expect(store().status).toBe('locked')
    await store().unlock('open sesame')
    expect(store().records.get(ada.id)).toBeDefined()
  })

  it('sanitizes hostile import payloads instead of persisting them', async () => {
    // Missing arrays, bad kinds, junk ids — all must be dropped or
    // repaired, and the vault must remain unlockable afterwards.
    const hostile = [
      { kind: 'person', id: 'x'.repeat(500), displayName: 'bad id' },
      { kind: 'person', id: crypto.randomUUID(), displayName: 'No Arrays' },
      { kind: 'exploit', id: crypto.randomUUID() },
      null,
      { kind: 'note', id: crypto.randomUUID() }, // no personId/body
    ]
    await store().importRecords(hostile)
    const people = [...store().records.values()].filter((r) => r.kind === 'person')
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ displayName: 'No Arrays', nicknames: [], tags: [] })

    store().lock()
    await expect(store().unlock('open sesame')).resolves.toBe(true)
  })

  it('PIN quick unlock: arm, lock, wrong tries, unlock, lock-out', async () => {
    const ada = await store().addPerson('Ada')
    // Wrong passphrase cannot arm a PIN.
    expect(await store().setPin('1234', 'not the passphrase')).toBe(false)
    expect(store().pinArmed).toBe(false)
    // Correct passphrase arms it.
    expect(await store().setPin('1234', 'open sesame')).toBe(true)
    expect(store().pinArmed).toBe(true)
    expect(store().pinDigits).toBe(4)

    store().lock()
    expect(store().pinArmed).toBe(true)
    expect(await store().unlockWithPin('9999')).toBe('wrong')
    expect(store().pinAttemptsLeft).toBe(4)
    expect(await store().unlockWithPin('1234')).toBe('ok')
    expect(store().records.get(ada.id)).toBeDefined()
    // The owner is told about the failed guess made while they were away.
    expect(store().pinFailureNotice).toBe(1)
    store().clearPinFailureNotice()

    // Exhausting attempts disarms the PIN entirely and flags the lock-out.
    store().lock()
    for (let i = 0; i < 5; i++) {
      expect(await store().unlockWithPin('0000')).toBe('wrong')
    }
    expect(store().pinArmed).toBe(false)
    expect(store().pinLockedOut).toBe(true)
    expect(await store().unlockWithPin('1234')).toBe('wrong')
    expect(await store().unlock('open sesame')).toBe(true)
    expect(store().pinLockedOut).toBe(false)
    store().forgetPin()
  })

  it('panic lock disarms the PIN; timer lock keeps it', async () => {
    await store().addPerson('Ada')
    expect(await store().setPin('1234', 'open sesame')).toBe(true)

    store().lock() // timer-driven
    expect(store().pinArmed).toBe(true)
    expect(await store().unlockWithPin('1234')).toBe('ok')

    store().panicLock()
    expect(store().pinArmed).toBe(false)
    expect(await store().unlockWithPin('1234')).toBe('wrong')
    expect(await store().unlock('open sesame')).toBe(true)
  })

  it('flushDrafts saves registered capture drafts as notes', async () => {
    const ada = await store().addPerson('Ada')
    let draft = 'half-typed fact about the sailboat'
    store().registerDraft(ada.id, () => draft)
    await store().flushDrafts()
    const notes = selectNotes(store().records, ada.id)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('half-typed fact about the sailboat')
    // Registry is drained: flushing again adds nothing.
    draft = 'other'
    await store().flushDrafts()
    expect(selectNotes(store().records, ada.id)).toHaveLength(1)
  })

  it('security settings persist through the encrypted settings record', async () => {
    await store().updateSecurity({ autoLockMinutes: 5, backgroundGraceSeconds: 120 })
    store().lock()
    await store().unlock('open sesame')
    const settings = [...store().records.values()].find((r) => r.kind === 'settings')
    expect(settings).toMatchObject({ autoLockMinutes: 5, backgroundGraceSeconds: 120 })
  })

  it('locking drops everything and unlock restores it', async () => {
    const ada = await store().addPerson('Ada')
    store().lock()
    expect(store().records.size).toBe(0)
    expect(store().vault).toBeNull()

    expect(await store().unlock('open sesame')).toBe(true)
    const person = store().records.get(ada.id)
    expect(person).toMatchObject({ kind: 'person', displayName: 'Ada' })
  })
}, 120_000)
