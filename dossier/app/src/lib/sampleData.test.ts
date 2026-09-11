import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { SAMPLE_TAG, loadSampleData } from './sampleData'
import { selectSelf } from './graphQueries'
import {
  selectNotes,
  selectPeople,
  selectRelationships,
  useVaultStore,
} from '../store/vaultStore'

const store = () => useVaultStore.getState()

describe('loadSampleData', () => {
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

  it('seeds an interconnected cast with a derived mention edge', async () => {
    const res = await loadSampleData()
    expect(res.peopleAdded).toBe(14)
    expect(res.edgesAdded).toBeGreaterThanOrEqual(20)
    expect(res.skippedNoSelf).toBe(0)

    const people = selectPeople(store().records).filter((p) => !p.isSelf)
    expect(people).toHaveLength(14)
    // Every seeded person carries the sample tag.
    expect(people.every((p) => p.tags.includes(SAMPLE_TAG))).toBe(true)

    // The Dana→Ivy mention note has no explicit edge, so a dashed mention
    // edge actually appears (the demo's whole point).
    const mentionEdges = selectRelationships(store().records).filter(
      (r) => r.origin === 'mention',
    )
    expect(mentionEdges.length).toBeGreaterThanOrEqual(1)
  })

  it('is idempotent: a second run adds nothing and stacks no notes', async () => {
    await loadSampleData()
    const notesBefore = [...store().records.values()].filter((r) => r.kind === 'note').length
    const res2 = await loadSampleData()
    expect(res2.peopleAdded).toBe(0)
    expect(res2.edgesAdded).toBe(0)
    const notesAfter = [...store().records.values()].filter((r) => r.kind === 'note').length
    expect(notesAfter).toBe(notesBefore)
  })

  it('re-adds only a deleted sample person on the next run', async () => {
    await loadSampleData()
    const grace = selectPeople(store().records).find((p) => p.displayName === 'Grace Liu')!
    await store().removePerson(grace.id)
    expect(selectPeople(store().records).some((p) => p.displayName === 'Grace Liu')).toBe(false)

    const res = await loadSampleData()
    expect(res.peopleAdded).toBe(1)
    expect(selectPeople(store().records).some((p) => p.displayName === 'Grace Liu')).toBe(true)
  })

  it('never adopts a real contact who shares a seeded name', async () => {
    // A real person named like a sample member, with real data, no sample tag.
    const real = await store().addPerson('Dana Kim')
    await store().updatePerson({ ...real, jobTitle: 'Real friend', tags: ['irl'] })

    await loadSampleData()

    const danas = selectPeople(store().records).filter((p) => p.displayName === 'Dana Kim')
    // The real Dana is untouched; a separate sample Dana was created.
    expect(danas).toHaveLength(2)
    const realAfter = danas.find((p) => p.id === real.id)!
    expect(realAfter.jobTitle).toBe('Real friend')
    expect(realAfter.tags).not.toContain(SAMPLE_TAG)
    // No fabricated note landed on the real Dana.
    expect(selectNotes(store().records, real.id)).toHaveLength(0)
  })

  it('reports skipped self-edges when no person is marked "me"', async () => {
    const me = selectSelf(store().records)!
    await store().removePerson(me.id)
    const res = await loadSampleData()
    expect(res.skippedNoSelf).toBeGreaterThan(0)
    // Nothing throws and the rest of the cast still connects.
    expect(res.peopleAdded).toBe(14)
  })
})
