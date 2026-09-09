/**
 * In-memory decrypted state and domain actions (REQUIREMENTS.md §6.1, §9).
 *
 * Everything here exists only while unlocked. `lock()` is the panic path
 * too: it drops the DEK reference, all decrypted records, and the search
 * index synchronously. Nothing in this store is persisted directly —
 * writes go through vault.saveRecord(s) and are mirrored here.
 */
import { create } from 'zustand'
import { extractMentions } from '../lib/mentions'
import {
  BUILT_IN_RELATIONSHIP_TYPES,
  type DomainRecord,
  type FollowUp,
  type NoteEntry,
  type PartialDate,
  type Person,
  type Relationship,
  type RelationshipType,
} from '../lib/models'
import { createIndex, rebuildIndex, reindexPerson, searchPeople } from '../lib/search'
import {
  createVault,
  deleteRecord,
  loadAllRecords,
  saveRecords,
  unlockVault,
  vaultExists,
  type UnlockedVault,
} from '../lib/vault'

// Module-level so it never renders and dies with lock(); rebuilt on unlock.
let searchIndex = createIndex()

interface VaultState {
  status: 'unknown' | 'no-vault' | 'locked' | 'unlocked'
  vault: UnlockedVault | null
  records: Map<string, DomainRecord>

  init: () => Promise<void>
  create: (passphrase: string) => Promise<void>
  unlock: (passphrase: string) => Promise<boolean>
  lock: () => void

  addPerson: (displayName: string) => Promise<Person>
  updatePerson: (person: Person) => Promise<void>
  removePerson: (personId: string) => Promise<void>
  saveNote: (personId: string, body: string) => Promise<void>
  removeNote: (noteId: string) => Promise<void>
  addFollowUp: (personId: string, text: string, dueDate?: PartialDate) => Promise<void>
  toggleFollowUp: (followUpId: string) => Promise<void>
  removeFollowUp: (followUpId: string) => Promise<void>
  addRelationship: (
    fromId: string,
    toId: string,
    typeId: string,
    note?: string,
  ) => Promise<void>
  removeRelationship: (relationshipId: string) => Promise<void>
  addRelationshipType: (label: string, color: string, directed: boolean) => Promise<void>
  importRecords: (incoming: DomainRecord[]) => Promise<number>
}

function requireVault(vault: UnlockedVault | null): UnlockedVault {
  if (!vault) throw new Error('locked')
  return vault
}

/** Built-in relationship types missing from the record set, ready to persist. */
function missingBuiltInTypes(records: Map<string, DomainRecord>): RelationshipType[] {
  const existing = new Set(
    [...records.values()]
      .filter((r): r is RelationshipType => r.kind === 'relationshipType' && r.builtIn)
      .map((r) => r.label),
  )
  return BUILT_IN_RELATIONSHIP_TYPES.filter((t) => !existing.has(t.label)).map((t) => ({
    ...t,
    id: crypto.randomUUID(),
  }))
}

function mentionTypeId(records: Map<string, DomainRecord>): string {
  for (const r of records.values()) {
    if (r.kind === 'relationshipType' && r.builtIn && r.label === 'mentioned') return r.id
  }
  throw new Error('built-in types not seeded')
}

/**
 * Mention-derived edges (§4.2): after person A's notes change, A should
 * have a mention-origin edge to exactly the people their notes mention and
 * who aren't already related to A some other way. Upgraded (explicit)
 * edges are never touched; stale mention edges are dropped.
 * Returns the puts/deletes to apply, without touching state.
 */
function diffMentionEdges(
  records: Map<string, DomainRecord>,
  personId: string,
): { puts: Relationship[]; deletes: string[] } {
  const mentioned = new Set<string>()
  for (const r of records.values()) {
    if (r.kind === 'note' && r.personId === personId) {
      for (const id of r.mentions) mentioned.add(id)
    }
  }
  mentioned.delete(personId)

  const relatedIds = new Set<string>()
  const mentionEdges: Relationship[] = []
  for (const r of records.values()) {
    if (r.kind !== 'relationship') continue
    if (r.fromId === personId || r.toId === personId) {
      const other = r.fromId === personId ? r.toId : r.fromId
      if (r.origin === 'mention' && r.fromId === personId) mentionEdges.push(r)
      else relatedIds.add(other)
    }
  }

  const deletes = mentionEdges
    .filter((e) => !mentioned.has(e.toId) || relatedIds.has(e.toId))
    .map((e) => e.id)
  const covered = new Set(mentionEdges.map((e) => e.toId))
  const puts: Relationship[] = []
  for (const id of mentioned) {
    if (relatedIds.has(id) || covered.has(id)) continue
    if (!records.has(id)) continue
    puts.push({
      kind: 'relationship',
      id: crypto.randomUUID(),
      fromId: personId,
      toId: id,
      typeId: mentionTypeId(records),
      directed: true,
      origin: 'mention',
      createdAt: Date.now(),
    })
  }
  return { puts, deletes }
}

export const useVaultStore = create<VaultState>((set, get) => {
  /** Persist and mirror a batch of puts/deletes, then refresh search docs. */
  async function apply(
    puts: DomainRecord[],
    deletes: string[] = [],
    reindexIds: string[] = [],
  ): Promise<void> {
    const vault = requireVault(get().vault)
    if (puts.length > 0) await saveRecords(vault, puts)
    for (const id of deletes) await deleteRecord(vault, id)
    const next = new Map(get().records)
    for (const record of puts) next.set(record.id, record)
    for (const id of deletes) next.delete(id)
    set({ records: next })
    for (const id of reindexIds) reindexPerson(searchIndex, next, id)
  }

  return {
    status: 'unknown',
    vault: null,
    records: new Map(),

    init: async () => {
      set({ status: (await vaultExists()) ? 'locked' : 'no-vault' })
    },

    create: async (passphrase) => {
      const vault = await createVault(passphrase)
      const records = new Map<string, DomainRecord>()
      const seed = missingBuiltInTypes(records)
      await saveRecords(vault, seed)
      for (const t of seed) records.set(t.id, t)
      searchIndex = createIndex()
      set({ status: 'unlocked', vault, records })
    },

    unlock: async (passphrase) => {
      const vault = await unlockVault(passphrase)
      if (!vault) return false
      const records = new Map((await loadAllRecords(vault)).map((r) => [r.id, r]))
      const seed = missingBuiltInTypes(records)
      if (seed.length > 0) {
        await saveRecords(vault, seed)
        for (const t of seed) records.set(t.id, t)
      }
      searchIndex = createIndex()
      rebuildIndex(searchIndex, records)
      set({ status: 'unlocked', vault, records })
      return true
    },

    lock: () => {
      searchIndex = createIndex()
      set({ status: 'locked', vault: null, records: new Map() })
    },

    addPerson: async (displayName) => {
      const person: Person = {
        kind: 'person',
        id: crypto.randomUUID(),
        displayName: displayName.trim() || 'Unnamed',
        nicknames: [],
        likes: [],
        dislikes: [],
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await apply([person], [], [person.id])
      return person
    },

    updatePerson: async (person) => {
      await apply([{ ...person, updatedAt: Date.now() }], [], [person.id])
    },

    removePerson: async (personId) => {
      const { records } = get()
      const deletes = [personId]
      for (const r of records.values()) {
        if (
          ((r.kind === 'note' || r.kind === 'followUp' || r.kind === 'photo') &&
            r.personId === personId) ||
          (r.kind === 'relationship' && (r.fromId === personId || r.toId === personId))
        ) {
          deletes.push(r.id)
        }
      }
      await apply([], deletes, [personId])
    },

    saveNote: async (personId, body) => {
      const note: NoteEntry = {
        kind: 'note',
        id: crypto.randomUUID(),
        personId,
        body,
        mentions: extractMentions(body),
        createdAt: Date.now(),
      }
      const withNote = new Map(get().records)
      withNote.set(note.id, note)
      const { puts, deletes } = diffMentionEdges(withNote, personId)
      await apply([note, ...puts], deletes, [personId])
    },

    removeNote: async (noteId) => {
      const note = get().records.get(noteId)
      if (!note || note.kind !== 'note') return
      const without = new Map(get().records)
      without.delete(noteId)
      const { puts, deletes } = diffMentionEdges(without, note.personId)
      await apply(puts, [noteId, ...deletes], [note.personId])
    },

    addFollowUp: async (personId, text, dueDate) => {
      const followUp: FollowUp = {
        kind: 'followUp',
        id: crypto.randomUUID(),
        personId,
        text,
        dueDate,
        done: false,
        createdAt: Date.now(),
      }
      await apply([followUp])
    },

    toggleFollowUp: async (followUpId) => {
      const f = get().records.get(followUpId)
      if (!f || f.kind !== 'followUp') return
      await apply([{ ...f, done: !f.done }])
    },

    removeFollowUp: async (followUpId) => {
      await apply([], [followUpId])
    },

    addRelationship: async (fromId, toId, typeId, note) => {
      const { records } = get()
      const type = records.get(typeId)
      if (!type || type.kind !== 'relationshipType') throw new Error('unknown type')
      // Upgrading: an explicit edge replaces any mention-derived edge
      // between the pair (§4.2).
      const deletes = [...records.values()]
        .filter(
          (r): r is Relationship =>
            r.kind === 'relationship' &&
            r.origin === 'mention' &&
            ((r.fromId === fromId && r.toId === toId) ||
              (r.fromId === toId && r.toId === fromId)),
        )
        .map((r) => r.id)
      const edge: Relationship = {
        kind: 'relationship',
        id: crypto.randomUUID(),
        fromId,
        toId,
        typeId,
        directed: type.directed,
        note,
        origin: 'explicit',
        createdAt: Date.now(),
      }
      await apply([edge], deletes)
    },

    removeRelationship: async (relationshipId) => {
      const edge = get().records.get(relationshipId)
      if (!edge || edge.kind !== 'relationship') return
      // If notes still mention the pair, the derived edge comes back.
      const without = new Map(get().records)
      without.delete(relationshipId)
      const { puts, deletes } = diffMentionEdges(without, edge.fromId)
      await apply(puts, [relationshipId, ...deletes])
    },

    addRelationshipType: async (label, color, directed) => {
      const type: RelationshipType = {
        kind: 'relationshipType',
        id: crypto.randomUUID(),
        label: label.trim(),
        color,
        directed,
        builtIn: false,
      }
      await apply([type])
    },

    importRecords: async (incoming) => {
      const vault = requireVault(get().vault)
      // Merge by id, incoming wins. Imported built-in types are matched by
      // label so a restore doesn't duplicate the seeded vocabulary.
      const records = new Map(get().records)
      const builtInByLabel = new Map(
        [...records.values()]
          .filter((r): r is RelationshipType => r.kind === 'relationshipType' && r.builtIn)
          .map((r) => [r.label, r.id]),
      )
      const idRemap = new Map<string, string>()
      const puts: DomainRecord[] = []
      for (const record of incoming) {
        if (record.kind === 'relationshipType' && record.builtIn) {
          const existingId = builtInByLabel.get(record.label)
          if (existingId && existingId !== record.id) {
            idRemap.set(record.id, existingId)
            continue
          }
        }
        puts.push(record)
      }
      for (const record of puts) {
        if (record.kind === 'relationship') {
          record.typeId = idRemap.get(record.typeId) ?? record.typeId
        }
        records.set(record.id, record)
      }
      await saveRecords(vault, puts)
      set({ records })
      rebuildIndex(searchIndex, records)
      return puts.length
    },
  }
})

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

export function selectNotes(records: Map<string, DomainRecord>, personId: string): NoteEntry[] {
  return [...records.values()]
    .filter((r): r is NoteEntry => r.kind === 'note' && r.personId === personId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function selectFollowUps(
  records: Map<string, DomainRecord>,
  personId: string,
): FollowUp[] {
  return [...records.values()]
    .filter((r): r is FollowUp => r.kind === 'followUp' && r.personId === personId)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt)
}

/** Search the in-memory index; returns person ids ranked by relevance. */
export function searchPeopleIds(query: string): string[] {
  return searchPeople(searchIndex, query)
}
