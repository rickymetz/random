import { describe, expect, it } from 'vitest'
import type { DomainRecord, Person, Relationship } from './models'
import { mutualConnections, selectSelf, shortestPath } from './graphQueries'

let uid = 0
function person(name: string, isSelf = false): Person {
  return {
    kind: 'person',
    id: `p${++uid}`,
    displayName: name,
    nicknames: [],
    likes: [],
    dislikes: [],
    tags: [],
    isSelf: isSelf || undefined,
    createdAt: 0,
    updatedAt: 0,
  }
}

function edge(from: Person, to: Person, origin: 'explicit' | 'mention' = 'explicit'): Relationship {
  return {
    kind: 'relationship',
    id: `e${++uid}`,
    fromId: from.id,
    toId: to.id,
    typeId: 't1',
    directed: false,
    origin,
    createdAt: 0,
  }
}

function recordsOf(...items: DomainRecord[]): Map<string, DomainRecord> {
  return new Map(items.map((r) => [r.id, r]))
}

describe('graph queries', () => {
  it('finds the shortest path regardless of edge direction', () => {
    const me = person('Me', true)
    const a = person('Alice')
    const b = person('Bob')
    const c = person('Carol')
    // me→a, b→a (reverse direction), b→c; also a longer route me→c? none.
    const records = recordsOf(me, a, b, c, edge(me, a), edge(b, a), edge(b, c))
    const path = shortestPath(records, me.id, c.id)
    expect(path?.map((s) => s.person.displayName)).toEqual(['Me', 'Alice', 'Bob', 'Carol'])
    expect(path?.[1].via).toBeDefined()
  })

  it('prefers fewer hops when multiple routes exist', () => {
    const me = person('Me', true)
    const a = person('A')
    const b = person('B')
    const x = person('X')
    const records = recordsOf(
      me, a, b, x,
      edge(me, a), edge(a, b), edge(b, x), // 3 hops
      edge(me, x), // 1 hop
    )
    const path = shortestPath(records, me.id, x.id)
    expect(path?.map((s) => s.person.displayName)).toEqual(['Me', 'X'])
  })

  it('returns null when unconnected and for self-to-self', () => {
    const me = person('Me', true)
    const island = person('Island')
    const records = recordsOf(me, island)
    expect(shortestPath(records, me.id, island.id)).toBeNull()
    expect(shortestPath(records, me.id, me.id)).toBeNull()
  })

  it('mention edges count as connections', () => {
    const me = person('Me', true)
    const a = person('A')
    const records = recordsOf(me, a, edge(me, a, 'mention'))
    expect(shortestPath(records, me.id, a.id)).toHaveLength(2)
  })

  it('ignores edges to deleted people', () => {
    const me = person('Me', true)
    const ghost = person('Ghost')
    const target = person('T')
    const records = recordsOf(me, target, edge(me, ghost), edge(ghost, target))
    // ghost person not in records
    records.delete(ghost.id)
    expect(shortestPath(records, me.id, target.id)).toBeNull()
  })

  it('finds mutual connections with both linking edges', () => {
    const a = person('A')
    const b = person('B')
    const m1 = person('Mutual One')
    const m2 = person('Mutual Two')
    const onlyA = person('Only A')
    const records = recordsOf(
      a, b, m1, m2, onlyA,
      edge(a, m1), edge(m1, b),
      edge(b, m2), edge(m2, a),
      edge(a, onlyA),
      edge(a, b), // direct edge must not appear as a "mutual"
    )
    const mutuals = mutualConnections(records, a.id, b.id)
    expect(mutuals.map((m) => m.person.displayName)).toEqual(['Mutual One', 'Mutual Two'])
    expect(mutuals[0].edgeToA).toBeDefined()
    expect(mutuals[0].edgeToB).toBeDefined()
  })

  it('selectSelf finds the designated person', () => {
    const me = person('Me', true)
    const other = person('Other')
    expect(selectSelf(recordsOf(other, me))?.id).toBe(me.id)
    expect(selectSelf(recordsOf(other))).toBeUndefined()
  })
})
