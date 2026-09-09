/**
 * In-memory full-text search (REQUIREMENTS.md §4.4).
 *
 * One MiniSearch document per person, aggregating every searchable string
 * about them — identity, structured fields, tags, likes/dislikes, and the
 * plain text of all their notes — so "the guy with the sailboat" finds the
 * person, not a note. Built at unlock, updated per change, never persisted.
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

function toDoc(person: Person, notes: NoteEntry[]): PersonDoc {
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
    tags: person.tags.join(' '),
    notes: notes.map((n) => plainText(n.body)).join(' '),
  }
}

export function rebuildIndex(
  index: MiniSearch<PersonDoc>,
  records: Map<string, DomainRecord>,
): void {
  index.removeAll()
  const notesByPerson = new Map<string, NoteEntry[]>()
  for (const r of records.values()) {
    if (r.kind === 'note') {
      const list = notesByPerson.get(r.personId) ?? []
      list.push(r)
      notesByPerson.set(r.personId, list)
    }
  }
  for (const r of records.values()) {
    if (r.kind === 'person') index.add(toDoc(r, notesByPerson.get(r.id) ?? []))
  }
}

/** Re-index one person after they or their notes changed. */
export function reindexPerson(
  index: MiniSearch<PersonDoc>,
  records: Map<string, DomainRecord>,
  personId: string,
): void {
  const person = records.get(personId)
  if (index.has(personId)) index.discard(personId)
  if (!person || person.kind !== 'person') return
  const notes = [...records.values()].filter(
    (r): r is NoteEntry => r.kind === 'note' && r.personId === personId,
  )
  index.add(toDoc(person, notes))
}

export function searchPeople(index: MiniSearch<PersonDoc>, query: string): string[] {
  return index.search(query).map((result) => result.id as string)
}
