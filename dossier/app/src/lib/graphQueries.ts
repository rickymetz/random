/**
 * Graph queries (REQUIREMENTS.md §4.4), surfaced as UI features rather
 * than a query language: shortest path ("how do I know X?", anchored on
 * the designated self person) and mutual connections. Edges are treated
 * as undirected for connectivity; mention-derived edges count (a mention
 * is still a real-world connection).
 */
import type { DomainRecord, Person, Relationship } from './models'

export interface PathStep {
  person: Person
  /** Edge that connects this person to the PREVIOUS step (undefined on the first). */
  via?: Relationship
}

interface Adjacency {
  neighbors: Map<string, { otherId: string; edge: Relationship }[]>
  people: Map<string, Person>
}

export function buildAdjacency(records: Map<string, DomainRecord>): Adjacency {
  const neighbors = new Map<string, { otherId: string; edge: Relationship }[]>()
  const people = new Map<string, Person>()
  for (const r of records.values()) {
    if (r.kind === 'person') people.set(r.id, r)
  }
  const push = (from: string, to: string, edge: Relationship) => {
    if (!people.has(from) || !people.has(to)) return
    const list = neighbors.get(from) ?? []
    list.push({ otherId: to, edge })
    neighbors.set(from, list)
  }
  for (const r of records.values()) {
    if (r.kind !== 'relationship') continue
    push(r.fromId, r.toId, r)
    push(r.toId, r.fromId, r)
  }
  return { neighbors, people }
}

/** Breadth-first shortest path, or null when unconnected. */
export function shortestPath(
  records: Map<string, DomainRecord>,
  fromId: string,
  toId: string,
): PathStep[] | null {
  if (fromId === toId) return null
  const { neighbors, people } = buildAdjacency(records)
  if (!people.has(fromId) || !people.has(toId)) return null

  const cameFrom = new Map<string, { prevId: string; edge: Relationship }>()
  const visited = new Set([fromId])
  let frontier = [fromId]
  while (frontier.length > 0 && !cameFrom.has(toId)) {
    const next: string[] = []
    for (const id of frontier) {
      for (const { otherId, edge } of neighbors.get(id) ?? []) {
        if (visited.has(otherId)) continue
        visited.add(otherId)
        cameFrom.set(otherId, { prevId: id, edge })
        next.push(otherId)
      }
    }
    frontier = next
  }
  if (!cameFrom.has(toId)) return null

  const steps: PathStep[] = []
  let cursor = toId
  while (cursor !== fromId) {
    const link = cameFrom.get(cursor)!
    steps.unshift({ person: people.get(cursor)!, via: link.edge })
    cursor = link.prevId
  }
  steps.unshift({ person: people.get(fromId)! })
  return steps
}

export interface MutualConnection {
  person: Person
  edgeToA: Relationship
  edgeToB: Relationship
}

/** People directly connected to BOTH a and b. */
export function mutualConnections(
  records: Map<string, DomainRecord>,
  aId: string,
  bId: string,
): MutualConnection[] {
  if (aId === bId) return []
  const { neighbors, people } = buildAdjacency(records)
  const aEdges = new Map<string, Relationship>()
  for (const { otherId, edge } of neighbors.get(aId) ?? []) {
    if (otherId !== bId && !aEdges.has(otherId)) aEdges.set(otherId, edge)
  }
  const out: MutualConnection[] = []
  const seen = new Set<string>()
  for (const { otherId, edge } of neighbors.get(bId) ?? []) {
    if (otherId === aId || seen.has(otherId)) continue
    seen.add(otherId)
    const edgeToA = aEdges.get(otherId)
    const person = people.get(otherId)
    if (edgeToA && person) out.push({ person, edgeToA, edgeToB: edge })
  }
  return out.sort((a, b) => a.person.displayName.localeCompare(b.person.displayName))
}

export function selectSelf(records: Map<string, DomainRecord>): Person | undefined {
  for (const r of records.values()) {
    if (r.kind === 'person' && r.isSelf) return r
  }
  return undefined
}
