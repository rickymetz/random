/**
 * In-memory full-text search (REQUIREMENTS.md §4.4).
 *
 * One MiniSearch document per person, aggregating every searchable string
 * about them — identity, structured fields, tags, likes/dislikes, the
 * plain text of all their notes, and the notes on their relationship
 * edges — so "the guy with the sailboat" finds the person, not a note.
 * Built at unlock, updated per change, never persisted.
 */
import MiniSearch from 'minisearch'
import { plainText } from './mentions'
import type { DomainRecord, NoteEntry, Person } from './models'

interface PersonDoc {
  id: string
  name: string
  details: string
  tags: string
  notes: string
}

export function createIndex(): MiniSearch<PersonDoc> {
  return new MiniSearch<PersonDoc>({
    fields: ['name', 'details', 'tags', 'notes'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.15,
      boost: { name: 3, tags: 2 },
    },
  })
}

function personTexts(records: Map<string, DomainRecord>, personId: string) {
  const notes: NoteEntry[] = []
  const edgeNotes: string[] = []
  const circleNames: string[] = []
  for (const r of records.values()) {
    if (r.kind === 'note' && r.personId === personId) notes.push(r)
    else if (r.kind === 'circle' && r.memberIds.includes(personId)) circleNames.push(r.name)
    else if (
      r.kind === 'relationship' &&
      r.note &&
      (r.fromId === personId || r.toId === personId)
    ) {
      edgeNotes.push(r.note)
    }
  }
  return { notes, edgeNotes, circleNames }
}

function toDoc(
  person: Person,
  notes: NoteEntry[],
  edgeNotes: string[],
  circleNames: string[] = [],
): PersonDoc {
  return {
    id: person.id,
    name: [person.displayName, ...person.nicknames].join(' '),
    details: [
      person.jobTitle,
      person.employer,
      person.location,
      person.howWeMet,
      person.pronouns,
      person.contact?.phone,
      person.contact?.email,
      person.contact?.other,
      ...person.likes,
      ...person.dislikes,
    ]
      .filter(Boolean)
      .join(' '),
    tags: [...person.tags, ...circleNames].join(' '),
    notes: [...notes.map((n) => plainText(n.body)), ...edgeNotes].join(' '),
  }
}

export function rebuildIndex(
  index: MiniSearch<PersonDoc>,
  records: Map<string, DomainRecord>,
): void {
  index.removeAll()
  for (const r of records.values()) {
    if (r.kind === 'person') {
      const { notes, edgeNotes, circleNames } = personTexts(records, r.id)
      index.add(toDoc(r, notes, edgeNotes, circleNames))
    }
  }
}

/** Re-index one person after they, their notes, or their edges changed. */
export function reindexPerson(
  index: MiniSearch<PersonDoc>,
  records: Map<string, DomainRecord>,
  personId: string,
): void {
  const person = records.get(personId)
  if (index.has(personId)) index.discard(personId)
  if (!person || person.kind !== 'person') return
  const { notes, edgeNotes, circleNames } = personTexts(records, personId)
  index.add(toDoc(person, notes, edgeNotes, circleNames))
}

export function searchPeople(index: MiniSearch<PersonDoc>, query: string): string[] {
  return index.search(query).map((result) => result.id as string)
}

/**
 * A short plain-text snippet from a person's notes containing the first
 * query term, for showing WHY a search matched (§4.4: "the guy with the
 * sailboat" needs the sailboat visible in the result row).
 */
export function matchSnippet(notes: readonly NoteEntry[], query: string): string | null {
  const term = query.trim().toLowerCase().split(/\s+/)[0]
  if (!term) return null
  for (const r of notes) {
    const text = plainText(r.body)
    const at = text.toLowerCase().indexOf(term)
    if (at >= 0) {
      const start = Math.max(0, at - 24)
      const end = Math.min(text.length, at + term.length + 40)
      return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    }
  }
  return null
}
