/**
 * Sample cast for exploring the graph view: three overlapping clusters
 * (work, the Webb/Kim families, a climbing circle) with bridges between
 * them and a couple of @mention notes for dashed derived edges. Loaded
 * on demand from Settings; everything is ordinary vault data afterwards
 * (delete any of them like a real person).
 *
 * Idempotent-ish: people are matched by display name and edges by
 * (pair, type), so a second run repairs gaps instead of duplicating.
 */

import { selectSelf } from './graphQueries'
import { mentionToken } from './mentions'
import type { Person } from './models'
import {
  selectPeople,
  selectRelationships,
  selectRelationshipTypes,
  useVaultStore,
} from '../store/vaultStore'

interface SamplePerson {
  name: string
  jobTitle?: string
  employer?: string
  location?: string
  howWeMet?: string
  likes?: string[]
  tags?: string[]
  birthday?: { month: number; day: number }
}

const CAST: SamplePerson[] = [
  { name: 'Priya Raman', jobTitle: 'Product lead', employer: 'Meridian Labs', location: 'Lisbon', tags: ['work'], likes: ['espresso', 'road cycling'] },
  { name: 'Marcus Webb', jobTitle: 'Engineer', employer: 'Meridian Labs', location: 'Lisbon', tags: ['work'], likes: ['synths'], birthday: { month: 3, day: 14 } },
  { name: 'Elena Sofia', jobTitle: 'Designer', employer: 'Meridian Labs', tags: ['work'], likes: ['risograph prints'] },
  { name: 'Nadia Osei', jobTitle: 'Architect', location: 'Lisbon', howWeMet: "Marcus's birthday dinner", likes: ['brutalism', 'orange wine'] },
  { name: 'June Webb', jobTitle: 'Retired teacher', location: 'Porto', likes: ['crosswords'] },
  { name: 'Harold Webb', jobTitle: 'Retired harbor pilot', location: 'Porto', likes: ['model ships'] },
  { name: 'Dana Kim', jobTitle: 'Editor', howWeMet: 'college', tags: ['college'], likes: ['karaoke'], birthday: { month: 9, day: 28 } },
  { name: 'Alex Kim', jobTitle: 'Chef', employer: 'Alfama Kitchen', likes: ['fermentation'] },
  { name: 'Sam Kim', jobTitle: 'Photographer', tags: ['climbing'], likes: ['alpine starts'] },
  { name: 'Theo Martins', jobTitle: 'Climbing coach', tags: ['climbing'], likes: ['crack climbing', 'pastel de nata'] },
  { name: 'Rosa Delgado', jobTitle: 'Marine biologist', location: 'Cascais', likes: ['tide pools'] },
  { name: 'Ivy Chen', jobTitle: 'Barista', employer: 'Little Fern', likes: ['latte art throwdowns'] },
  { name: 'Bruno Costa', jobTitle: 'Boat builder', location: 'Setúbal', likes: ['wooden hulls'] },
  { name: 'Grace Liu', jobTitle: 'Doctor', tags: ['book club'], likes: ['sci-fi'] },
]

/** [from, type label, to] — 'me' stands for the vault's self person. */
const EDGES: [string, string, string][] = [
  // Work cluster
  ['Priya Raman', 'boss of', 'Marcus Webb'],
  ['Priya Raman', 'boss of', 'Elena Sofia'],
  ['Marcus Webb', 'coworker', 'Elena Sofia'],
  ['me', 'coworker', 'Marcus Webb'],
  ['Priya Raman', 'boss of', 'me'],
  // Webb family
  ['June Webb', 'parent of', 'Marcus Webb'],
  ['Harold Webb', 'parent of', 'Marcus Webb'],
  ['June Webb', 'married', 'Harold Webb'],
  ['Nadia Osei', 'partner', 'Marcus Webb'],
  // Kim family
  ['Dana Kim', 'married', 'Alex Kim'],
  ['Alex Kim', 'sibling', 'Sam Kim'],
  ['me', 'friend', 'Dana Kim'],
  // Climbing circle
  ['Theo Martins', 'roommate', 'Sam Kim'],
  ['me', 'friend', 'Theo Martins'],
  ['Sam Kim', 'friend', 'Rosa Delgado'],
  // Bridges between clusters
  ['Elena Sofia', 'friend', 'Theo Martins'],
  ['Rosa Delgado', 'ex', 'Marcus Webb'],
  ['Ivy Chen', 'friend', 'Elena Sofia'],
  ['Ivy Chen', 'friend', 'Dana Kim'],
  ['Bruno Costa', 'friend', 'Sam Kim'],
  ['Grace Liu', 'sibling', 'Priya Raman'],
  ['Grace Liu', 'friend', 'Nadia Osei'],
]

/** [author, mentioned] — saved as notes; the store derives dashed edges. */
const MENTION_NOTES: [string, string, (token: string) => string][] = [
  ['Dana Kim', 'Ivy Chen', (t) => `Coffee at Little Fern — ${t} pulled a heart on the flat white`],
  ['Theo Martins', 'Bruno Costa', (t) => `Wants to borrow ${t}'s van for the Sagres trip`],
]

export interface SampleDataResult {
  peopleAdded: number
  edgesAdded: number
}

export async function loadSampleData(): Promise<SampleDataResult> {
  const store = useVaultStore.getState()
  const byName = new Map(
    selectPeople(store.records).map((p) => [p.displayName.toLowerCase(), p]),
  )

  let peopleAdded = 0
  const idOf = new Map<string, string>()
  for (const sample of CAST) {
    const existing = byName.get(sample.name.toLowerCase())
    if (existing) {
      idOf.set(sample.name, existing.id)
      continue
    }
    const created = await store.addPerson(sample.name)
    const filled: Person = {
      ...created,
      jobTitle: sample.jobTitle,
      employer: sample.employer,
      location: sample.location,
      howWeMet: sample.howWeMet,
      birthday: sample.birthday,
      likes: sample.likes ?? [],
      tags: sample.tags ?? [],
    }
    await store.updatePerson(filled)
    idOf.set(sample.name, created.id)
    peopleAdded += 1
  }

  // Re-read after the inserts so lookups below see the new people.
  const state = useVaultStore.getState()
  const self = selectSelf(state.records)
  const typeByLabel = new Map(
    selectRelationshipTypes(state.records).map((t) => [t.label, t]),
  )
  const resolve = (name: string): string | undefined =>
    name === 'me' ? self?.id : idOf.get(name)

  const existingEdges = new Set(
    selectRelationships(state.records).map((r) =>
      [r.typeId, ...[r.fromId, r.toId].sort()].join('|'),
    ),
  )

  let edgesAdded = 0
  for (const [fromName, typeLabel, toName] of EDGES) {
    const fromId = resolve(fromName)
    const toId = resolve(toName)
    const type = typeByLabel.get(typeLabel)
    if (!fromId || !toId || !type) continue
    const key = [type.id, ...[fromId, toId].sort()].join('|')
    if (existingEdges.has(key)) continue
    await useVaultStore.getState().addRelationship(fromId, toId, type.id)
    existingEdges.add(key)
    edgesAdded += 1
  }

  for (const [authorName, mentionedName, body] of MENTION_NOTES) {
    const authorId = idOf.get(authorName)
    const mentioned = CAST.find((c) => c.name === mentionedName)
    const mentionedId = mentioned && idOf.get(mentioned.name)
    if (!authorId || !mentionedId) continue
    // Only on first load: a repeat run must not stack duplicate notes.
    const alreadyNoted = [...useVaultStore.getState().records.values()].some(
      (r) => r.kind === 'note' && r.personId === authorId && r.body.includes(mentionedId),
    )
    if (alreadyNoted) continue
    await useVaultStore
      .getState()
      .saveNote(authorId, body(mentionToken({ id: mentionedId, displayName: mentionedName })))
  }

  return { peopleAdded, edgesAdded }
}
