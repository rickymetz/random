import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { selectSelf } from './graphQueries'
import { STRESS_TAG, buildStressRecords, loadStressCast, removeStressCast } from './stressData'
import {
  searchPeopleIds,
  selectCircles,
  selectPeople,
  selectRelationshipTypes,
  selectRelationships,
  useVaultStore,
} from '../store/vaultStore'

const store = () => useVaultStore.getState()

describe('buildStressRecords', () => {
  it('is deterministic for a seed and links every reference to a generated person', () => {
    const types = selectRelationshipTypes(new Map())
    const a = buildStressRecords(50, { types: [], seed: 7, now: 1000 })
    const b = buildStressRecords(50, { types: [], seed: 7, now: 1000 })
    expect(a.records.map((r) => (r.kind === 'person' ? r.displayName : r.kind))).toEqual(
      b.records.map((r) => (r.kind === 'person' ? r.displayName : r.kind)),
    )
    expect(types).toHaveLength(0)
    const ids = new Set(a.records.filter((r) => r.kind === 'person').map((r) => r.id))
    for (const r of a.records) {
      if (r.kind === 'note') {
        expect(ids.has(r.personId)).toBe(true)
        for (const m of r.mentions) expect(ids.has(m)).toBe(true)
      }
      if (r.kind === 'circle') for (const m of r.memberIds) expect(ids.has(m)).toBe(true)
    }
    // Names are unique so the People list and search stay meaningful.
    const names = a.records.filter((r) => r.kind === 'person').map((r) => r.displayName)
    expect(new Set(names).size).toBe(names.length)
    expect(a.counts.people).toBe(50)
    // No relationship types known → no edges at all (no dangling typeIds).
    expect(a.counts.edges).toBe(0)
  })
})

describe('loadStressCast / removeStressCast', () => {
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

  it('bulk-loads a crowd with edges, mention edges, circles, and search, then removes it', async () => {
    const res = await loadStressCast(120, 3)
    expect(res.people).toBe(120)
    expect(res.notes).toBeGreaterThan(250)
    expect(res.circles).toBe(8)

    const people = selectPeople(store().records).filter((p) => !p.isSelf)
    expect(people).toHaveLength(120)
    expect(people.every((p) => p.tags.includes(STRESS_TAG))).toBe(true)
    const rels = selectRelationships(store().records)
    expect(rels.length).toBe(res.edges)
    expect(rels.some((r) => r.origin === 'mention')).toBe(true)
    // Every edge resolves to a known type and to existing people.
    const typeIds = new Set(selectRelationshipTypes(store().records).map((t) => t.id))
    for (const r of rels) {
      expect(typeIds.has(r.typeId)).toBe(true)
      expect(store().records.has(r.fromId) && store().records.has(r.toId)).toBe(true)
    }
    // Some edges anchor on the self person so how-you-connect has paths.
    const self = selectSelf(store().records)!
    expect(rels.some((r) => r.fromId === self.id || r.toId === self.id)).toBe(true)
    // Search index was rebuilt over the crowd.
    expect(searchPeopleIds(people[0].displayName.split(' ')[0]).length).toBeGreaterThan(0)

    const removed = await removeStressCast()
    expect(removed).toBe(120)
    expect(selectPeople(store().records).filter((p) => !p.isSelf)).toHaveLength(0)
    expect(selectRelationships(store().records)).toHaveLength(0)
    expect(selectCircles(store().records)).toHaveLength(0)
    expect(searchPeopleIds(people[0].displayName.split(' ')[0])).toHaveLength(0)
    // Removing again is a no-op.
    expect(await removeStressCast()).toBe(0)
  })

  it('removePeople keeps a circle that still has other members', async () => {
    const a = await store().addPerson('Keep Me')
    const b = await store().addPerson('Drop Me')
    const c = await store().addCircle('Mixed')
    await store().updateCircle({ ...c, memberIds: [a.id, b.id] })
    await store().removePeople([b.id])
    const circle = selectCircles(store().records)[0]
    expect(circle.memberIds).toEqual([a.id])
  })
})
