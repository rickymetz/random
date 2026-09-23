import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../lib/db'
import { mentionToken } from '../lib/mentions'
import { MAX_FIELDS, activeFields } from '../lib/fieldDefs'
import type { CustomValue, FieldDef, FieldType, Person } from '../lib/models'
import {
  searchPeopleIds,
  selectCircles,
  selectFieldDefs,
  selectCirclesOf,
  selectNotes,
  selectPeople,
  selectRelationships,
  selectRelationshipTypes,
  selectSettings,
  useVaultStore,
} from './vaultStore'

const store = () => useVaultStore.getState()

describe('vault store', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    await db.blobs.clear()
    await db.auth.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  it('seeds a self person on create and keeps at most one self', async () => {
    const { selectSelf } = await import('../lib/graphQueries')
    const me = selectSelf(store().records)
    expect(me).toMatchObject({ displayName: 'Me', isSelf: true })

    const ada = await store().addPerson('Ada')
    await store().updatePerson({ ...ada, isSelf: true })
    const self = selectSelf(store().records)
    expect(self?.id).toBe(ada.id)
    const selves = [...store().records.values()].filter(
      (r) => r.kind === 'person' && r.isSelf,
    )
    expect(selves).toHaveLength(1)
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
    const people = [...store().records.values()].filter(
      (r) => r.kind === 'person' && !r.isSelf,
    )
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

  it('a note being written survives the page going away, and comes back on unlock', async () => {
    const ada = await store().addPerson('Ada')
    await store().persistDraft(ada.id, 'half a thought about the regatta')
    // A reload runs no lock and flushes nothing: only what is on disk is left.
    store().lock()
    expect(await store().unlock('open sesame')).toBe(true)
    expect(store().drafts.get(ada.id)).toBe('half a thought about the regatta')
    // Encrypted at rest like everything else.
    const rows = await db.records.toArray()
    expect(JSON.stringify(rows)).not.toContain('regatta')
    // Emptying the box forgets it.
    await store().persistDraft(ada.id, '')
    store().lock()
    await store().unlock('open sesame')
    expect(store().drafts.has(ada.id)).toBe(false)
  })

  it('a draft that became a note on lock does not come back as a draft too', async () => {
    const ada = await store().addPerson('Ada')
    const text = 'met at the harbour'
    await store().persistDraft(ada.id, text)
    store().registerDraft(ada.id, () => text)
    await store().flushDrafts()
    store().lock()
    await store().unlock('open sesame')
    expect(selectNotes(store().records, ada.id).map((n) => n.body)).toEqual([text])
    expect(store().drafts.has(ada.id)).toBe(false)
  })

  it('deleting a person takes their unfinished note with them', async () => {
    const ada = await store().addPerson('Ada')
    const bo = await store().addPerson('Bo')
    await store().persistDraft(ada.id, 'about Ada')
    await store().persistDraft(bo.id, 'about Bo')
    await store().removePerson(ada.id)
    // …and a late write for someone gone is refused.
    await store().persistDraft(ada.id, 'again')
    store().lock()
    await store().unlock('open sesame')
    expect([...store().drafts.entries()]).toEqual([[bo.id, 'about Bo']])
  })

  it('drafts never join the records — so never a backup, and never a re-render', async () => {
    const ada = await store().addPerson('Ada')
    const before = store().records
    await store().persistDraft(ada.id, 'not for export')
    expect(store().records).toBe(before)
    store().lock()
    await store().unlock('open sesame')
    expect([...store().records.values()].some((r) => (r as { kind: string }).kind === 'draft')).toBe(false)
    expect(JSON.stringify([...store().records.values()])).not.toContain('not for export')
    // A backup claiming to carry one doesn't bring it in.
    await store().importRecords([
      { kind: 'draft', id: 'd1', personId: ada.id, body: 'smuggled', updatedAt: 1 },
    ])
    expect(JSON.stringify([...store().records.values()])).not.toContain('smuggled')
  })

  it('an edit being made to a note, or to the details, comes back on unlock', async () => {
    const ada = await store().addPerson('Ada')
    await store().saveNote(ada.id, 'Sails on Sundays')
    const note = selectNotes(store().records, ada.id)[0]
    const slot = `note:${note.id}` as const
    await store().persistDraft(ada.id, 'Sails on Saturdays now', slot)
    await store().persistDraft(ada.id, '{"form":{"location":"Lisbon"}}', 'details')
    // Read back at once, ahead of the write: an editor reopening in the
    // same breath it closed must not miss it.
    const write = store().persistDraft(ada.id, 'Sails on Saturdays, mostly', slot)
    expect(store().readDraft(ada.id, slot)).toBe('Sails on Saturdays, mostly')
    await write
    store().lock()
    expect(await store().unlock('open sesame')).toBe(true)
    expect(store().readDraft(ada.id, slot)).toBe('Sails on Saturdays, mostly')
    expect(store().readDraft(ada.id, 'details')).toBe('{"form":{"location":"Lisbon"}}')
    // Neither is the note box's draft, nor in the records.
    expect(store().drafts.has(ada.id)).toBe(false)
    expect(JSON.stringify([...store().records.values()])).not.toContain('Saturdays')
    // Saving is one write with forgetting.
    await store().updateNote(note.id, 'Sails on Saturdays', { clearDraft: true })
    await store().updatePerson({ ...ada, location: 'Lisbon' }, { clearDraft: true })
    expect(store().readDraft(ada.id, slot)).toBeUndefined()
    store().lock()
    await store().unlock('open sesame')
    expect(store().readDraft(ada.id, slot)).toBeUndefined()
    expect(store().readDraft(ada.id, 'details')).toBeUndefined()
    expect(selectNotes(store().records, ada.id)[0].body).toBe('Sails on Saturdays')
  })

  it('a kept edit goes with its note, and every draft goes with the person', async () => {
    const ada = await store().addPerson('Ada')
    await store().saveNote(ada.id, 'one')
    await store().saveNote(ada.id, 'two')
    const [a, b] = selectNotes(store().records, ada.id)
    await store().persistDraft(ada.id, 'edit of a', `note:${a.id}`)
    await store().persistDraft(ada.id, 'edit of b', `note:${b.id}`)
    await store().removeNote(a.id)
    expect(store().readDraft(ada.id, `note:${a.id}`)).toBeUndefined()
    // …and a late write for a note that's gone is refused.
    await store().persistDraft(ada.id, 'again', `note:${a.id}`)
    store().lock()
    await store().unlock('open sesame')
    expect(store().readDraft(ada.id, `note:${a.id}`)).toBeUndefined()
    expect(store().readDraft(ada.id, `note:${b.id}`)).toBe('edit of b')

    await store().persistDraft(ada.id, '{"form":{}}', 'details')
    await store().persistDraft(ada.id, 'box')
    await store().removePerson(ada.id)
    store().lock()
    await store().unlock('open sesame')
    expect(store().readDraft(ada.id, `note:${b.id}`)).toBeUndefined()
    expect(store().readDraft(ada.id, 'details')).toBeUndefined()
    expect(store().drafts.size).toBe(0)
    const rows = await db.records.count()
    // Only what the vault itself keeps is left on disk: no stray drafts.
    store().lock()
    await store().unlock('open sesame')
    expect(await db.records.count()).toBe(rows)
  })

  it('a lock writes the edits still waiting on a pause in typing', async () => {
    const ada = await store().addPerson('Ada')
    let waiting = true
    const unregister = store().registerDraftSaver(async () => {
      if (waiting) await store().persistDraft(ada.id, '{"form":{"pronouns":"she/her"}}', 'details')
      waiting = false
    })
    await store().flushDrafts()
    unregister()
    store().lock()
    await store().unlock('open sesame')
    expect(store().readDraft(ada.id, 'details')).toBe('{"form":{"pronouns":"she/her"}}')
  })

  it('updateNote re-derives mention edges from the new text', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    const cy = await store().addPerson('Cy')
    await store().saveNote(ada.id, `Lunch with ${mentionToken(bob)}`)
    const note = selectNotes(store().records, ada.id)[0]
    expect(selectRelationships(store().records).map((r) => r.toId)).toEqual([bob.id])

    await store().updateNote(note.id, `Lunch with ${mentionToken(cy)} instead`)
    const edited = selectNotes(store().records, ada.id)[0]
    expect(edited.id).toBe(note.id)
    expect(edited.body).toContain(cy.id)
    // Bob's dashed edge is gone; Cy's exists.
    expect(selectRelationships(store().records).map((r) => r.toId)).toEqual([cy.id])
  })

  it('renaming a person rewrites @mention labels in other people’s notes', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob Jones')
    await store().saveNote(ada.id, `Met ${mentionToken(bob)} at the pier`)
    await store().updatePerson({ ...bob, displayName: 'Bob Jones-Park' })
    const note = selectNotes(store().records, ada.id)[0]
    expect(note.body).toContain('@[Bob Jones-Park](')
    expect(note.body).not.toContain('@[Bob Jones](')
    // The link itself (id) is untouched and the edge still stands.
    expect(note.mentions).toEqual([bob.id])
    expect(selectRelationships(store().records)).toHaveLength(1)
  })

  it('saveNote never resurrects a deleted person', async () => {
    const ada = await store().addPerson('Ada')
    await store().removePerson(ada.id)
    // A draft flush racing the delete must not persist an orphan note.
    await store().saveNote(ada.id, 'note for a person that no longer exists')
    expect(selectNotes(store().records, ada.id)).toHaveLength(0)
    const orphanNotes = [...store().records.values()].filter(
      (r) => r.kind === 'note' && r.personId === ada.id,
    )
    expect(orphanNotes).toHaveLength(0)
  })

  it('circles: create by name, membership, rename, and cascades', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    const c1 = await store().addCircle('College friends')
    const again = await store().addCircle('college FRIENDS')
    expect(again.id).toBe(c1.id) // case-insensitive name reuse
    const c2 = await store().addCircle('DC polycule')
    expect(c1.color).not.toBe(c2.color) // auto-assigned distinct hues

    await store().setPersonCircles(ada.id, [c1.id, c2.id])
    await store().setPersonCircles(bob.id, [c1.id])
    expect(selectCirclesOf(store().records, ada.id).map((c) => c.id).sort()).toEqual(
      [c1.id, c2.id].sort(),
    )
    // Removing one keeps the other
    await store().setPersonCircles(ada.id, [c2.id])
    expect(selectCirclesOf(store().records, ada.id).map((c) => c.id)).toEqual([c2.id])

    // Rename + recolor persist; members untouched
    const freshC2 = selectCircles(store().records).find((c) => c.id === c2.id)!
    await store().updateCircle({ ...freshC2, name: 'DC crew', color: '#a8d070' })
    const renamed = selectCircles(store().records).find((c) => c.id === c2.id)!
    expect(renamed).toMatchObject({ name: 'DC crew', color: '#a8d070', memberIds: [ada.id] })

    // Deleting a person removes them from every circle
    await store().removePerson(ada.id)
    expect(selectCircles(store().records).every((c) => !c.memberIds.includes(ada.id))).toBe(true)
    // Empty circles persist until deleted explicitly
    expect(selectCircles(store().records).some((c) => c.id === c2.id)).toBe(true)
    await store().removeCircle(c2.id)
    expect(selectCircles(store().records).some((c) => c.id === c2.id)).toBe(false)
    // People survive a circle delete
    expect(store().records.has(bob.id)).toBe(true)
  })

  it('updateCircle refuses a name another circle already uses', async () => {
    const a = await store().addCircle('College friends')
    const b = await store().addCircle('DC crew')
    const result = await store().updateCircle({ ...b, name: 'college FRIENDS' })
    expect(result).toBe('name-taken')
    expect(selectCircles(store().records).find((c) => c.id === b.id)?.name).toBe('DC crew')
    // Renaming to itself (case change) is fine.
    expect(await store().updateCircle({ ...a, name: 'College Friends' })).toBe('ok')
  })

  it('restore keeps relationship types even when a relationship precedes its type in the bundle', async () => {
    const ada = await store().addPerson('Ada')
    const bob = await store().addPerson('Bob')
    // A bundle from another device: its own ids for the built-in types,
    // and the relationship row listed BEFORE the type row.
    const foreignPartnerId = crypto.randomUUID()
    await store().importRecords([
      {
        kind: 'relationship',
        id: crypto.randomUUID(),
        fromId: ada.id,
        toId: bob.id,
        typeId: foreignPartnerId,
        directed: false,
        origin: 'explicit',
        createdAt: 1,
      },
      {
        kind: 'relationshipType',
        id: foreignPartnerId,
        label: 'partner',
        color: '#e2567a',
        directed: false,
        builtIn: true,
      },
    ])
    const localPartner = selectRelationshipTypes(store().records).find((t) => t.label === 'partner')!
    const edge = selectRelationships(store().records)[0]
    expect(edge.typeId).toBe(localPartner.id)
    expect(store().records.has(foreignPartnerId)).toBe(false)
  })

  it('imported circles are sanitized: bad member ids dropped, bad color defaulted', async () => {
    const ada = await store().addPerson('Ada')
    await store().importRecords([
      {
        kind: 'circle',
        id: 'c-import',
        name: '  Book club ',
        color: 'javascript:alert(1)',
        memberIds: [ada.id, '<script>', 42, ada.id],
      },
    ])
    const c = selectCircles(store().records).find((x) => x.id === 'c-import')!
    expect(c.name).toBe('Book club')
    expect(c.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(c.memberIds).toEqual([ada.id])
  })

  it('security settings persist through the encrypted settings record', async () => {
    await store().updateSecurity({ autoLockMinutes: 5, backgroundGraceSeconds: 120 })
    store().lock()
    await store().unlock('open sesame')
    const settings = [...store().records.values()].find((r) => r.kind === 'settings')
    expect(settings).toMatchObject({ autoLockMinutes: 5, backgroundGraceSeconds: 120 })
  })

  it('photos: add, avatar handoff, delete, and cascade with the person', async () => {
    const ada = await store().addPerson('Ada')
    const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 3]) // jpeg-ish
    await store().addPhotoBytes(ada.id, bytes, 'image/jpeg', true)
    await store().addPhotoBytes(ada.id, new Uint8Array([9, 9, 9]), 'image/jpeg', false)

    const { selectPhotos, selectAvatar } = await import('./vaultStore')
    let photos = selectPhotos(store().records, ada.id)
    expect(photos).toHaveLength(2)
    expect(selectAvatar(store().records, ada.id)?.id).toBe(photos[0].id)

    // Round-trip the blob through the encrypted blob store.
    const { loadBlob } = await import('../lib/vault')
    const loaded = await loadBlob(store().vault!, photos[0].blobRecordId)
    expect([...loaded!]).toEqual([...bytes])

    // Promote the second photo; exactly one avatar remains.
    await store().setAvatarPhoto(photos[1].id)
    photos = selectPhotos(store().records, ada.id)
    expect(photos.filter((p) => p.isAvatar)).toHaveLength(1)
    expect(selectAvatar(store().records, ada.id)?.id).toBe(photos[0].id) // sorted avatar-first

    // Deleting the person removes photo records AND their blobs.
    const blobIds = photos.map((p) => p.blobRecordId)
    await store().removePerson(ada.id)
    expect(selectPhotos(store().records, ada.id)).toHaveLength(0)
    const { db } = await import('../lib/db')
    expect(await db.blobs.count()).toBe(0)
    void blobIds
  })

  it('restoring a backup with a self person demotes the seeded "Me"', async () => {
    const { selectSelf } = await import('../lib/graphQueries')
    const seeded = selectSelf(store().records)!
    await store().importRecords([
      {
        kind: 'person',
        id: crypto.randomUUID(),
        displayName: 'Real Me',
        nicknames: [],
        likes: [],
        dislikes: [],
        tags: [],
        isSelf: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const selves = [...store().records.values()].filter(
      (r) => r.kind === 'person' && r.isSelf,
    )
    expect(selves).toHaveLength(1)
    expect((selves[0] as { displayName: string }).displayName).toBe('Real Me')
    expect((store().records.get(seeded.id) as { isSelf?: boolean }).isSelf).toBeUndefined()
  })

  it('import never overwrites device-local settings', async () => {
    await store().updateSecurity({ autoLockMinutes: 2 })
    await store().importRecords([
      { kind: 'settings', id: 'settings', autoLockMinutes: 0, backgroundGraceSeconds: 3600 },
    ])
    const settings = [...store().records.values()].find((r) => r.kind === 'settings')
    expect(settings).toMatchObject({ autoLockMinutes: 2 })
  })

  it('import remaps blob ids so a bundle cannot overwrite existing photo bytes', async () => {
    const ada = await store().addPerson('Ada')
    await store().addPhotoBytes(ada.id, new Uint8Array([1, 1, 1]), 'image/jpeg', true)
    const { selectPhotos } = await import('./vaultStore')
    const existing = selectPhotos(store().records, ada.id)[0]

    // Hostile bundle targets the existing blob id with different bytes.
    await store().importRecords(
      [
        {
          kind: 'photo',
          id: crypto.randomUUID(),
          personId: ada.id,
          isAvatar: false,
          mimeType: 'text/html', // must be coerced to a safe image type
          blobRecordId: existing.blobRecordId,
          createdAt: Date.now(),
        },
      ],
      [{ id: existing.blobRecordId, bytes: new Uint8Array([66, 66]) }],
    )
    const { loadBlob } = await import('../lib/vault')
    // Original bytes intact; imported photo got a fresh blob id + jpeg type.
    expect([...(await loadBlob(store().vault!, existing.blobRecordId))!]).toEqual([1, 1, 1])
    const photos = selectPhotos(store().records, ada.id)
    expect(photos).toHaveLength(2)
    const imported = photos.find((p) => p.id !== existing.id)!
    expect(imported.blobRecordId).not.toBe(existing.blobRecordId)
    expect(imported.mimeType).toBe('image/jpeg')
    expect([...(await loadBlob(store().vault!, imported.blobRecordId))!]).toEqual([66, 66])
  })

  it('import preserves the one-avatar-per-person invariant', async () => {
    const ada = await store().addPerson('Ada')
    await store().addPhotoBytes(ada.id, new Uint8Array([1]), 'image/jpeg', true)
    const blobId = crypto.randomUUID()
    await store().importRecords(
      [
        {
          kind: 'photo',
          id: crypto.randomUUID(),
          personId: ada.id,
          isAvatar: true,
          mimeType: 'image/jpeg',
          blobRecordId: blobId,
          createdAt: Date.now(),
        },
      ],
      [{ id: blobId, bytes: new Uint8Array([2]) }],
    )
    const { selectPhotos } = await import('./vaultStore')
    const avatars = selectPhotos(store().records, ada.id).filter((p) => p.isAvatar)
    expect(avatars).toHaveLength(1)
  })

  it('deleting the avatar photo promotes the next one', async () => {
    const ada = await store().addPerson('Ada')
    await store().addPhotoBytes(ada.id, new Uint8Array([1]), 'image/jpeg', true)
    await store().addPhotoBytes(ada.id, new Uint8Array([2]), 'image/jpeg', false)
    const { selectPhotos, selectAvatar } = await import('./vaultStore')
    const avatar = selectAvatar(store().records, ada.id)!
    await store().removePhoto(avatar.id)
    const photos = selectPhotos(store().records, ada.id)
    expect(photos).toHaveLength(1)
    expect(photos[0].isAvatar).toBe(true)
  })

  it('unlock sweeps orphaned blob rows', async () => {
    const ada = await store().addPerson('Ada')
    await store().addPhotoBytes(ada.id, new Uint8Array([1]), 'image/jpeg', true)
    const { saveBlob } = await import('../lib/vault')
    await saveBlob(store().vault!, crypto.randomUUID(), new Uint8Array([9, 9]))
    const { db } = await import('../lib/db')
    expect(await db.blobs.count()).toBe(2)
    store().lock()
    await store().unlock('open sesame')
    expect(await db.blobs.count()).toBe(1)
  })

  it('import restores only blobs referenced by sanitized photo records', async () => {
    const ada = await store().addPerson('Ada')
    const photoId = crypto.randomUUID()
    const blobId = crypto.randomUUID()
    await store().importRecords(
      [
        {
          kind: 'photo',
          id: photoId,
          personId: ada.id,
          isAvatar: true,
          mimeType: 'image/jpeg',
          blobRecordId: blobId,
          createdAt: Date.now(),
        },
      ],
      [
        { id: blobId, bytes: new Uint8Array([4, 5, 6]) },
        { id: crypto.randomUUID(), bytes: new Uint8Array([7, 7, 7]) }, // unreferenced
      ],
    )
    const { db } = await import('../lib/db')
    expect(await db.blobs.count()).toBe(1)
    // Blob ids are remapped on import — read through the photo record.
    const { selectPhotos } = await import('./vaultStore')
    const photo = selectPhotos(store().records, ada.id)[0]
    const { loadBlob } = await import('../lib/vault')
    expect([...(await loadBlob(store().vault!, photo.blobRecordId))!]).toEqual([4, 5, 6])
    void photoId
    void blobId
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

describe('recent dossiers (noteVisit)', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    await db.blobs.clear()
    await db.auth.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  it('keeps the newest first, dedupes, caps, skips self, and prunes deletions', async () => {
    const a = await store().addPerson('Ada')
    const b = await store().addPerson('Bob')
    const self = selectPeople(store().records).find((p) => p.isSelf)!
    await store().noteVisit(a.id)
    await store().noteVisit(b.id)
    await store().noteVisit(a.id)
    await store().noteVisit(self.id)
    await store().noteVisit('not-a-person')
    expect(selectSettings(store().records)?.recentIds).toEqual([a.id, b.id])
    // Re-visiting the newest is a no-op write.
    const before = selectSettings(store().records)
    await store().noteVisit(a.id)
    expect(selectSettings(store().records)).toBe(before)
    // Cap.
    const extra = []
    for (let i = 0; i < 10; i++) extra.push(await store().addPerson(`P${i}`))
    for (const p of extra) await store().noteVisit(p.id)
    expect(selectSettings(store().records)?.recentIds).toHaveLength(8)
    expect(selectSettings(store().records)?.recentIds?.[0]).toBe(extra[9].id)
    // Deleting a person drops them from the row.
    await store().removePerson(extra[9].id)
    expect(selectSettings(store().records)?.recentIds?.[0]).toBe(extra[8].id)
    expect(selectSettings(store().records)?.recentIds).not.toContain(extra[9].id)
  })
})

describe('bulk add (addPeople / addRelationships)', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    await db.blobs.clear()
    await db.auth.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  it('creates several people in one write and links them, upgrading mention edges', async () => {
    const anchor = await store().addPerson('Anchor')
    const [sam, priya] = await store().addPeople(['Sam Okafor', 'Priya Raman'])
    expect(selectPeople(store().records).map((p) => p.displayName)).toEqual(
      expect.arrayContaining(['Sam Okafor', 'Priya Raman']),
    )
    // A prior mention edge anchor → sam gets replaced by the explicit one.
    await store().saveNote(anchor.id, `Met ${mentionToken(sam)}`)
    expect(selectRelationships(store().records).filter((r) => r.origin === 'mention')).toHaveLength(1)
    const friend = selectRelationshipTypes(store().records).find((t) => t.label === 'friend')!
    const coworker = selectRelationshipTypes(store().records).find((t) => t.label === 'coworker')!
    await store().addRelationships([
      { fromId: anchor.id, toId: sam.id, typeId: friend.id },
      { fromId: anchor.id, toId: priya.id, typeId: coworker.id },
      { fromId: anchor.id, toId: priya.id, typeId: friend.id }, // second role on the pair: kept
      { fromId: priya.id, toId: anchor.id, typeId: coworker.id }, // same role again: skipped
      { fromId: anchor.id, toId: 'nope', typeId: friend.id }, // unknown person: skipped
    ])
    const rels = selectRelationships(store().records)
    expect(rels.filter((r) => r.origin === 'mention')).toHaveLength(0)
    expect(rels.filter((r) => r.origin === 'explicit')).toHaveLength(3)
    expect(searchPeopleIds('Priya').length).toBe(1)
  })

  it('former roles, their dates, a custom type\'s family and the suggestions switch survive lock and unlock', async () => {
    // The sanitizer runs on every unlock: anything it drops is silently
    // lost on the next relock, so every persisted field must round-trip.
    const a = await store().addPerson('Ada')
    const b = await store().addPerson('Bea')
    const mentor = await store().addRelationshipType('mentor', '#123456', true, 'work')
    await store().addRelationship(a.id, b.id, mentor.id, undefined, {
      former: true,
      startDate: { year: 2019, month: 3 },
      endDate: { year: 2021, month: 6 },
    })
    await store().updateSecurity({ nameSuggestions: false })
    store().lock()
    expect(await store().unlock('open sesame')).toBe(true)
    const rel = selectRelationships(store().records).find((r) => r.typeId === mentor.id)!
    expect(rel.former).toBe(true)
    expect(rel.startDate).toEqual({ year: 2019, month: 3 })
    expect(rel.endDate).toEqual({ year: 2021, month: 6 })
    const type = selectRelationshipTypes(store().records).find((t) => t.id === mentor.id)!
    expect(type.family).toBe('work')
    expect(selectSettings(store().records)?.nameSuggestions).toBe(false)
  })

  it('a pair can carry several roles, never the same one twice, and a role can change in place', async () => {
    const a = await store().addPerson('Ada')
    const b = await store().addPerson('Bea')
    const types = selectRelationshipTypes(store().records)
    const coworker = types.find((t) => t.label === 'coworker')!
    const partner = types.find((t) => t.label === 'partner')!
    const friend = types.find((t) => t.label === 'friend')!
    await store().addRelationship(a.id, b.id, coworker.id)
    await store().addRelationship(b.id, a.id, coworker.id) // same role, other way round: no-op
    await store().addRelationship(a.id, b.id, partner.id, undefined, {
      former: true,
      startDate: { year: 2019 },
      endDate: { year: 2021 },
    })
    let rels = selectRelationships(store().records)
    expect(rels).toHaveLength(2)
    const past = rels.find((r) => r.typeId === partner.id)!
    expect(past.former).toBe(true)
    expect(past.startDate).toEqual({ year: 2019 })
    expect(past.endDate).toEqual({ year: 2021 })
    // Retype in place keeps the pair and the dates; clearing a date works.
    await store().updateRelationship(past.id, { typeId: friend.id, former: false, endDate: null })
    rels = selectRelationships(store().records)
    const changed = rels.find((r) => r.id === past.id)!
    expect(changed.typeId).toBe(friend.id)
    expect(changed.former).toBeUndefined()
    expect(changed.startDate).toEqual({ year: 2019 })
    expect(changed.endDate).toBeUndefined()
    // Retyping onto a role the pair already has folds into it.
    await store().updateRelationship(changed.id, { typeId: coworker.id })
    rels = selectRelationships(store().records)
    expect(rels).toHaveLength(1)
    expect(rels[0].typeId).toBe(coworker.id)
  })
})

describe('looks like people (linkNamesInNote)', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    await db.blobs.clear()
    await db.auth.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  it('creates people, rewrites the note to @mentions and derives mention edges in one go', async () => {
    const sam = await store().addPerson('Sam Okafor')
    const priya = await store().addPerson('Priya Raman')
    const note = await store().saveNote(sam.id, "Lunch with Theo Martins and Priya. Theo's treat.")
    expect(note?.kind).toBe('note')
    const { linked, created } = await store().linkNamesInNote(note!.id, [
      { phrase: 'Theo Martins' },
      { phrase: 'Priya', personId: priya.id },
      { phrase: 'Nobody Here' }, // not in the text → no person created
      { phrase: 'Sam Okafor', personId: sam.id }, // the note's own person → ignored
      { phrase: 'Sam Okafor' }, // by name, still the owner → ignored
    ])
    expect(linked.map((p) => p.displayName)).toEqual(['Theo Martins', 'Priya Raman'])
    expect(created.map((p) => p.displayName)).toEqual(['Theo Martins'])
    expect(selectPeople(store().records).filter((p) => p.displayName === 'Sam Okafor')).toHaveLength(1)
    const theo = selectPeople(store().records).find((p) => p.displayName === 'Theo Martins')!
    expect(theo).toBeDefined()
    expect(selectPeople(store().records).some((p) => p.displayName === 'Nobody Here')).toBe(false)
    const saved = store().records.get(note!.id)
    expect(saved?.kind === 'note' && saved.body).toBe(
      `Lunch with ${mentionToken(theo)} and ${mentionToken(priya)}. Theo's treat.`,
    )
    // A second pass links the lone first name now that Theo exists (possessive kept).
    await store().linkNamesInNote(note!.id, [{ phrase: 'Theo', personId: theo.id }])
    const again = store().records.get(note!.id)
    expect(again?.kind === 'note' && again.body.endsWith(`${mentionToken(theo)}'s treat.`)).toBe(true)
    expect(saved?.kind === 'note' && saved.mentions).toEqual([theo.id, priya.id])
    const edges = [...store().records.values()].filter(
      (r) => r.kind === 'relationship' && r.origin === 'mention' && r.fromId === sam.id,
    )
    expect(edges.map((e) => e.kind === 'relationship' && e.toId).sort()).toEqual([theo.id, priya.id].sort())
    // The new person is searchable straight away.
    expect(searchPeopleIds('Theo')).toContain(theo.id)
  })

  it('links the longest phrase first and reuses a person created in the same batch', async () => {
    const sam = await store().addPerson('Sam Okafor')
    const note = await store().saveNote(sam.id, 'Theo called. Then met Theo Martins, and Theo again.')
    const { linked, created } = await store().linkNamesInNote(note!.id, [{ phrase: 'Theo' }, { phrase: 'Theo Martins' }])
    expect(created.map((p) => p.displayName)).toEqual(['Theo Martins'])
    expect(linked).toHaveLength(1)
    const theo = created[0]
    const saved = store().records.get(note!.id)
    expect(saved?.kind === 'note' && saved.body).toBe(
      `${mentionToken(theo)} called. Then met ${mentionToken(theo)}, and ${mentionToken(theo)} again.`,
    )
    expect(selectPeople(store().records).filter((p) => p.displayName.startsWith('Theo'))).toHaveLength(1)
  })

  it('is a no-op write when nothing matches', async () => {
    const sam = await store().addPerson('Sam Okafor')
    const note = await store().saveNote(sam.id, 'Quiet day.')
    const before = store().records
    expect(await store().linkNamesInNote(note!.id, [{ phrase: 'Theo' }])).toEqual({ linked: [], created: [] })
    expect(store().records).toBe(before)
  })
})

describe('contacts import (importPeople)', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    await db.blobs.clear()
    await db.auth.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  it('creates people with details and a first note in one write, and indexes them', async () => {
    const people = await store().importPeople([
      {
        displayName: 'Sam Okafor',
        nicknames: ['Sammy', ' '],
        jobTitle: 'Head of Design',
        employer: 'Acme Ltd',
        location: 'Brighton, UK',
        birthday: { month: 6, day: 12 },
        contact: { phone: '+44 7700 900123', email: 'sam@example.com' },
        note: 'Met at the conference.',
      },
      { displayName: '  ' },
      { displayName: 'Priya Raman' },
    ])
    expect(people.map((p) => p.displayName)).toEqual(['Sam Okafor', 'Priya Raman'])
    const sam = store().records.get(people[0].id)
    expect(sam).toMatchObject({
      kind: 'person',
      nicknames: ['Sammy'],
      jobTitle: 'Head of Design',
      employer: 'Acme Ltd',
      location: 'Brighton, UK',
      birthday: { month: 6, day: 12 },
      contact: { phone: '+44 7700 900123', email: 'sam@example.com' },
    })
    const notes = [...store().records.values()].filter((r) => r.kind === 'note' && r.personId === people[0].id)
    expect(notes).toHaveLength(1)
    expect(notes[0].kind === 'note' && notes[0].body).toBe('Met at the conference.')
    expect(searchPeopleIds('Acme')).toContain(people[0].id)
    expect(searchPeopleIds('Priya')).toContain(people[1].id)
    // Undo path: removing them drops the note too.
    await store().removePeople(people.map((p) => p.id))
    expect([...store().records.values()].some((r) => r.kind === 'note')).toBe(false)
  })
})

describe('the person form this vault defines', () => {
  beforeEach(async () => {
    await db.slots.clear()
    await db.records.clear()
    await db.blobs.clear()
    await db.auth.clear()
    useVaultStore.setState({
      status: 'unknown',
      vault: null,
      records: new Map(),
      corrupted: 0,
      homeQuery: '',
    })
    await store().create('open sesame')
  })

  const addField = async (label: string, type: FieldType = 'chips') => {
    const def = await store().addField({ label, type })
    expect(typeof def).not.toBe('string')
    return def as FieldDef
  }
  const answer = async (personId: string, fieldId: string, value: CustomValue) => {
    const person = store().records.get(personId) as Person
    await store().updatePerson({ ...person, custom: { ...person.custom, [fieldId]: value } })
  }
  const personById = (id: string) => store().records.get(id) as Person

  it('answers survive lock and unlock, every shape of them', async () => {
    // The sanitizer runs on every unlock: anything it drops is silently
    // lost on the next relock. A "no" and a zero are answers too.
    const ada = await store().addPerson('Ada')
    const allergies = await addField('Allergies', 'chips')
    const cards = await addField('Sends cards', 'boolean')
    const kids = await addField('Kids', 'number')
    const anniversary = await addField('Anniversary', 'date')
    const met = await addField('Where we met', 'choice')
    await answer(ada.id, allergies.id, ['peanuts', 'shellfish'])
    await answer(ada.id, cards.id, false)
    await answer(ada.id, kids.id, 0)
    await answer(ada.id, anniversary.id, { year: 2014, month: 6, day: 21 })
    await answer(ada.id, met.id, 'conference')
    store().lock()
    expect(await store().unlock('open sesame')).toBe(true)
    expect(personById(ada.id).custom).toEqual({
      [allergies.id]: ['peanuts', 'shellfish'],
      [cards.id]: false,
      [kids.id]: 0,
      [anniversary.id]: { year: 2014, month: 6, day: 21 },
      [met.id]: 'conference',
    })
    const def = selectFieldDefs(store().records).find((d) => d.id === allergies.id)!
    expect(def).toMatchObject({ label: 'Allergies', type: 'chips' })
  })

  it('finds a person by what they answered, and stops when the field retires', async () => {
    const ada = await store().addPerson('Ada')
    await store().addPerson('Bea')
    const allergies = await addField('Allergies')
    await answer(ada.id, allergies.id, ['peanuts'])
    expect(searchPeopleIds('peanuts')).toEqual([ada.id])
    await store().retireField(allergies.id)
    expect(searchPeopleIds('peanuts')).toEqual([])
    await store().restoreField(allergies.id)
    expect(searchPeopleIds('peanuts')).toEqual([ada.id])
  })

  it('retiring keeps every answer, and restoring brings them back', async () => {
    const ada = await store().addPerson('Ada')
    const fears = await addField('Fears', 'longText')
    await answer(ada.id, fears.id, 'heights')
    await store().retireField(fears.id)
    expect(personById(ada.id).custom?.[fears.id]).toBe('heights')
    expect(activeFields(selectFieldDefs(store().records))).toHaveLength(0)
    // And through a relock, since that is when a sanitizer would eat it.
    store().lock()
    expect(await store().unlock('open sesame')).toBe(true)
    expect(personById(ada.id).custom?.[fears.id]).toBe('heights')
    expect(await store().restoreField(fears.id)).toBe('ok')
    expect(activeFields(selectFieldDefs(store().records))).toHaveLength(1)
    expect(personById(ada.id).custom?.[fears.id]).toBe('heights')
  })

  it('deleting the answers takes the field and the answers, and nothing else', async () => {
    const ada = await store().addPerson('Ada')
    const fears = await addField('Fears', 'longText')
    const likes = await addField('Gift ideas')
    await answer(ada.id, fears.id, 'heights')
    await answer(ada.id, likes.id, ['books'])
    await store().retireField(fears.id)
    await store().deleteFieldAndAnswers(fears.id)
    expect(selectFieldDefs(store().records).find((d) => d.id === fears.id)).toBeUndefined()
    expect(personById(ada.id).custom).toEqual({ [likes.id]: ['books'] })
    expect(personById(ada.id).displayName).toBe('Ada')
  })

  it('refuses a duplicate label and keeps the form under its cap', async () => {
    await addField('Allergies')
    expect(await store().addField({ label: 'allergies ', type: 'text' })).toBe('name-taken')
    expect(await store().addField({ label: '   ', type: 'text' })).toBe('name-taken')
    for (let i = 1; i < MAX_FIELDS; i++) await addField(`Field ${i}`)
    expect(await store().addField({ label: 'One too many', type: 'text' })).toBe('full')
  })

  it('renaming a field never touches an answer', async () => {
    const ada = await store().addPerson('Ada')
    const def = await addField('Allergies')
    await answer(ada.id, def.id, ['peanuts'])
    expect(await store().updateField({ ...def, label: 'Dietary needs' })).toBe('ok')
    expect(personById(ada.id).custom?.[def.id]).toEqual(['peanuts'])
    expect(searchPeopleIds('peanuts')).toEqual([ada.id])
  })

  it('a packs run seeds the form and never duplicates a row you already have', async () => {
    const first = await store().applyFieldPacks(['family', 'work'])
    expect(first).toBeGreaterThan(0)
    const labels = activeFields(selectFieldDefs(store().records)).map((d) => d.label)
    // "How we met" is in both the family pack and the essentials pack.
    expect(new Set(labels).size).toBe(labels.length)
    expect(await store().applyFieldPacks(['family'])).toBe(0)
  })

  it('reordering renumbers the form', async () => {
    const a = await addField('A')
    const b = await addField('B')
    const c = await addField('C')
    await store().reorderFields([c.id, a.id, b.id])
    expect(activeFields(selectFieldDefs(store().records)).map((d) => d.label)).toEqual(['C', 'A', 'B'])
  })
})
