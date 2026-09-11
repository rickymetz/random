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
      // Every word must hit: "bike pump" should not list every mechanic.
      combineWith: 'AND',
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

/** One pass over the records (not one per person: at 1,000 people that
 * was a second of unlock time on a phone), then a single addAll. */
export function rebuildIndex(
  index: MiniSearch<PersonDoc>,
  records: Map<string, DomainRecord>,
): void {
  index.removeAll()
  const people: Person[] = []
  const notes = new Map<string, NoteEntry[]>()
  const edgeNotes = new Map<string, string[]>()
  const circleNames = new Map<string, string[]>()
  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  for (const r of records.values()) {
    if (r.kind === 'person') people.push(r)
    else if (r.kind === 'note') push(notes, r.personId, r)
    else if (r.kind === 'circle') for (const id of r.memberIds) push(circleNames, id, r.name)
    else if (r.kind === 'relationship' && r.note) {
      push(edgeNotes, r.fromId, r.note)
      push(edgeNotes, r.toId, r.note)
    }
  }
  index.addAll(
    people.map((p) =>
      toDoc(p, notes.get(p.id) ?? [], edgeNotes.get(p.id) ?? [], circleNames.get(p.id) ?? []),
    ),
  )
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
  const phrase = query.trim().toLowerCase()
  const first = phrase.split(/\s+/)[0]
  if (!first) return null
  // The whole phrase first, then its first word — so "bike pump" shows
  // the pump line, not whichever note mentions a bike.
  for (const term of phrase === first ? [first] : [phrase, first]) {
    for (const r of notes) {
      const text = plainText(r.body)
      const at = text.toLowerCase().indexOf(term)
      if (at < 0) continue
      let start = Math.max(0, at - 24)
      // Snap to a word boundary rather than cutting "…ow after the".
      if (start > 0) {
        const space = text.lastIndexOf(' ', start)
        start = space > 0 && at - space < 40 ? space + 1 : start
      }
      let end = Math.min(text.length, at + term.length + 40)
      if (end < text.length) {
        const space = text.indexOf(' ', end)
        if (space > 0 && space - end < 12) end = space
      }
      return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    }
  }
  return null
}
