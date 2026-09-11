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
  selectCircles,
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
  // Bridges between clusters. NOTE: no explicit Ivy–Dana edge — their
  // link comes from the @mention note below, so a dashed derived edge
  // actually shows on the graph (an explicit edge would suppress it).
  ['Elena Sofia', 'friend', 'Theo Martins'],
  ['Rosa Delgado', 'ex', 'Marcus Webb'],
  ['Ivy Chen', 'friend', 'Elena Sofia'],
  ['Bruno Costa', 'friend', 'Sam Kim'],
  ['Grace Liu', 'sibling', 'Priya Raman'],
  ['Grace Liu', 'friend', 'Nadia Osei'],
]

/**
 * [author, mentioned, body, guard] — saved as notes; the store derives
 * dashed mention edges. `guard` is a distinctive substring used to detect
 * an already-seeded copy (person ids change if a person is re-created,
 * so the id inside the mention token can't be the duplicate key).
 */
const MENTION_NOTES: [string, string, (token: string) => string, string][] = [
  [
    'Dana Kim',
    'Ivy Chen',
    (t) => `Coffee at Little Fern — ${t} pulled a heart on the flat white`,
    'pulled a heart on the flat white',
  ],
  [
    'Theo Martins',
    'Bruno Costa',
    (t) => `Wants to borrow ${t}'s van for the Sagres trip`,
    'van for the Sagres trip',
  ],
]

/** Every seeded person carries this tag: it scopes re-run matching (a real
 * contact who shares a name is never adopted into the cast) and makes the
 * cast easy to find and clean up. */
export const SAMPLE_TAG = 'sample'

/** Circles (§4.6) — overlapping groups so bubbles visibly intersect. */
const CIRCLES: [string, string[]][] = [
  ['Meridian Labs', ['Priya Raman', 'Marcus Webb', 'Elena Sofia']],
  ['Webb family', ['June Webb', 'Harold Webb', 'Marcus Webb', 'Nadia Osei']],
  ['Climbing crew', ['Theo Martins', 'Sam Kim', 'Bruno Costa']],
]

export interface SampleDataResult {
  peopleAdded: number
  edgesAdded: number
  /** 'me'-anchored edges skipped because no person is marked as self. */
  skippedNoSelf: number
  circlesAdded: number
}

export async function loadSampleData(): Promise<SampleDataResult> {
  const store = useVaultStore.getState()
  // Only match people the loader itself created (sample tag): a real
  // contact who happens to share a seeded name must never have fictional
  // edges or notes attached to their dossier.
  const byName = new Map(
    selectPeople(store.records)
      .filter((p) => p.tags.includes(SAMPLE_TAG))
      .map((p) => [p.displayName.toLowerCase(), p]),
  )

  let peopleAdded = 0
  const idOf = new Map<string, string>()
  for (const sample of CAST) {
    const tags = [...(sample.tags ?? []), SAMPLE_TAG]
    const existing = byName.get(sample.name.toLowerCase())
    if (existing) {
      idOf.set(sample.name, existing.id)
      // Repair a half-seeded person (addPerson succeeded, the field fill
      // didn't): backfill only fields that are still empty.
      if (!existing.jobTitle && sample.jobTitle) {
        await store.updatePerson({
          ...existing,
          jobTitle: sample.jobTitle,
          employer: existing.employer ?? sample.employer,
          location: existing.location ?? sample.location,
          howWeMet: existing.howWeMet ?? sample.howWeMet,
          birthday: existing.birthday ?? sample.birthday,
          likes: existing.likes.length ? existing.likes : (sample.likes ?? []),
          tags: existing.tags.length > 1 ? existing.tags : tags,
        })
      }
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
      tags,
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
  let skippedNoSelf = 0
  for (const [fromName, typeLabel, toName] of EDGES) {
    const fromId = resolve(fromName)
    const toId = resolve(toName)
    const type = typeByLabel.get(typeLabel)
    if (!type) continue
    if (!fromId || !toId) {
      // Only 'me' can be unresolvable; surface the skip instead of
      // silently thinning the how-you-connect demo.
      if (fromName === 'me' || toName === 'me') skippedNoSelf += 1
      continue
    }
    const key = [type.id, ...[fromId, toId].sort()].join('|')
    if (existingEdges.has(key)) continue
    await useVaultStore.getState().addRelationship(fromId, toId, type.id)
    existingEdges.add(key)
    edgesAdded += 1
  }

  for (const [authorName, mentionedName, body, guard] of MENTION_NOTES) {
    const authorId = idOf.get(authorName)
    const mentionedId = idOf.get(mentionedName)
    if (!authorId || !mentionedId) continue
    // Only on first load: a repeat run must not stack duplicate notes.
    // Keyed on distinctive text, not ids — re-created people get new ids.
    const alreadyNoted = [...useVaultStore.getState().records.values()].some(
      (r) => r.kind === 'note' && r.personId === authorId && r.body.includes(guard),
    )
    if (alreadyNoted) continue
    await useVaultStore
      .getState()
      .saveNote(authorId, body(mentionToken({ id: mentionedId, displayName: mentionedName })))
  }

  let circlesAdded = 0
  for (const [name, memberNames] of CIRCLES) {
    const memberIds = memberNames
      .map((n) => resolve(n))
      .filter((id): id is string => Boolean(id))
    const st = useVaultStore.getState()
    const existing = selectCircles(st.records).find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      // Only touch a circle the loader itself made: a real circle that
      // happens to share a name must never absorb fictional people.
      const sampleOnly = existing.memberIds.every((id) => {
        const p = st.records.get(id)
        return p?.kind === 'person' && p.tags.includes(SAMPLE_TAG)
      })
      if (!sampleOnly) continue
      const merged = [...new Set([...existing.memberIds, ...memberIds])]
      if (merged.length !== existing.memberIds.length) {
        await st.updateCircle({ ...existing, memberIds: merged })
      }
      continue
    }
    const created = await st.addCircle(name)
    await useVaultStore.getState().updateCircle({ ...created, memberIds })
    circlesAdded += 1
  }

  return { peopleAdded, edgesAdded, skippedNoSelf, circlesAdded }
}
