/**
 * Bulk stress cast for scale testing (REQUIREMENTS.md §7 "hundreds of
 * people"): a deterministic, clustered crowd of N fictional people with
 * notes, explicit + mention-derived edges, circles, birthdays and
 * follow-ups, bulk-loaded through `importRecords` in one write instead of
 * N round trips. Everything it adds carries STRESS_TAG so it can be
 * removed again in one go.
 *
 * Reachable from Settings only behind `?dev=1`: it's a tool for profiling
 * the app, not a feature.
 */

import { selectSelf } from './graphQueries'
import { mentionToken } from './mentions'
import {
  CIRCLE_COLORS,
  type Circle,
  type DomainRecord,
  type FollowUp,
  type NoteEntry,
  type Person,
  type Photo,
  type Relationship,
  type RelationshipType,
} from './models'
import { selectPeople, selectRelationshipTypes, useVaultStore } from '../store/vaultStore'

export const STRESS_TAG = 'stress-test'

/** A valid 4×4 PNG (a flat neutral grey — the accent is budgeted for actions). */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGPwcrOHIwbiOABRUwzxc/bWYwAAAABJRU5ErkJggg=='
export function tinyPngBytes(): Uint8Array {
  const bin = atob(TINY_PNG_B64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const FIRST = [
  'Amara', 'Bea', 'Caleb', 'Dev', 'Esme', 'Farid', 'Gwen', 'Hugo', 'Ines', 'Jonah',
  'Kai', 'Lena', 'Milo', 'Nour', 'Otis', 'Pia', 'Quinn', 'Rafa', 'Suki', 'Tomas',
  'Uma', 'Viktor', 'Wren', 'Ximena', 'Yusuf', 'Zara', 'Ada', 'Benji', 'Cora', 'Dario',
  'Eli', 'Freya', 'Gus', 'Hana', 'Idris', 'Jade', 'Kofi', 'Leo', 'Maya', 'Nico',
]
const LAST = [
  'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Haddad', 'Novak', 'Reyes', 'Ferreira',
  'Kowalski', 'Mbeki', 'Sato', 'Andersen', 'Delacroix', 'Petrov', 'Nguyen', 'Iyer',
  'Costa', 'Byrne', 'Fischer', 'Alvarez', 'Chaudhry', 'Eriksen', 'Gallo', 'Hassan',
  'Jensen', 'Kaur', 'Lopes', 'Marsh', 'Nakamura', 'Oyelaran', 'Park', 'Quiroga',
  'Rossi', 'Silva', 'Torres', 'Ueda', 'Vance', 'Weiss', 'Yilmaz', 'Zhou',
]
const JOBS = [
  'Nurse', 'Carpenter', 'Data analyst', 'Teacher', 'Barista', 'Architect', 'Lawyer',
  'Sound engineer', 'Florist', 'Physio', 'Product manager', 'Chef', 'Illustrator',
  'Electrician', 'Librarian', 'Pilot', 'Translator', 'Vet', 'Bike mechanic', 'Actor',
]
const EMPLOYERS = [
  'Meridian Labs', 'Harbour Clinic', 'Northwind Co-op', 'Blue Kite Studio', 'City Library',
  'Ferro & Sons', 'Lumen Energy', 'Pinewood School', 'Tidewater Bakery', 'Orbit Media',
  'Atlas Logistics', 'Greenline Transit', 'Sable Films', 'Quarry Fitness', 'Marlow Legal',
]
const CITIES = [
  'Lisbon', 'Porto', 'Berlin', 'Leeds', 'Austin', 'Nairobi', 'Kyoto', 'Montréal',
  'Valparaíso', 'Tbilisi', 'Oslo', 'Cape Town', 'Melbourne', 'Ljubljana', 'Bristol',
]
const TAGS = [
  'work', 'college', 'neighbour', 'climbing', 'book club', 'choir', 'football',
  'ex-colleague', 'family friend', 'conference', 'volunteering', 'running',
]
const LIKES = [
  'espresso', 'orange wine', 'sci-fi', 'crosswords', 'sourdough', 'synths', 'tide pools',
  'karaoke', 'road cycling', 'ceramics', 'chess', 'birding', 'jazz', 'thrifting',
  'board games', 'hiking', 'noodles', 'gardening', 'photography', 'swimming',
  'old maps', 'vinyl', 'ramen', 'trail running', 'knitting', 'sailing', 'tango',
  'podcasts', 'brutalism', 'fermentation',
]
const MET = [
  "a friend's birthday dinner", 'college', 'the climbing gym', 'a conference in Berlin',
  'the school gate', 'a wedding', 'the dog park', 'a hackathon', 'choir practice',
  'the flat upstairs', 'a train delay', 'volunteering at the food bank',
]
const NOTE_TEMPLATES = [
  'Mentioned they are thinking about moving to {city} next year.',
  'Loves {like} — bring it up next time.',
  'Kid just started school; nervous about the commute.',
  'Recommended a book on {like}; said it changed how they think about work.',
  'Coffee at Little Fern. Talked about {like} for an hour.',
  'Their partner is training for a marathon in {city}.',
  'Started a new job at {employer}. Seems relieved.',
  'Allergic to shellfish — remember for dinner plans.',
  'Has a sailboat moored near {city}; offered to take us out in June.',
  'Wants to learn {like}. Said the same thing last year.',
  'Bumped into them at the market; they asked about the {like} thing.',
  'Birthday is coming up; they said no gifts, but they would like {like}.',
  'Just back from {city}. Brought back a ridiculous amount of tea.',
  'Feeling low after the layoffs at {employer}; check in next week.',
  'Ran the {city} half with {mention} — both swore never again.',
  'Long call with {mention} about the house move.',
  'Dinner with {mention} and their new partner; went well.',
  'Says {mention} owes them a bike pump.',
]
const FOLLOW_UPS = [
  'Send the article about {like}',
  'Ask how the interview at {employer} went',
  'Book dinner before they leave for {city}',
  'Return the drill',
  'Reply to their message about the trip',
  'Send birthday card',
]
const EDGE_TYPES: [string, number][] = [
  ['friend', 40], ['coworker', 25], ['sibling', 6], ['partner', 6], ['married', 5],
  ['ex', 4], ['parent of', 6], ['boss of', 4], ['roommate', 4],
]

/** Small deterministic PRNG (mulberry32) so runs are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface StressBuildOptions {
  types: RelationshipType[]
  /** The vault's self person, to anchor a few edges on "me". */
  selfId?: string
  seed?: number
  now?: number
  /** Average notes per person. Default 3.3 (300 people → ~1,000 notes). */
  notesPerPerson?: number
}

export interface StressCounts {
  people: number
  notes: number
  edges: number
  circles: number
  followUps: number
  photos: number
}

/** Pure generator: the records to import for a crowd of `n` people. */
export function buildStressRecords(
  n: number,
  opts: StressBuildOptions,
): { records: DomainRecord[]; blobs: { id: string; bytes: Uint8Array }[]; counts: StressCounts } {
  const rand = rng(opts.seed ?? 20260911)
  const now = opts.now ?? Date.now()
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const chance = (p: number) => rand() < p
  const ago = (maxDays: number) => now - Math.floor(rand() * maxDays) * 86_400_000
  const typeByLabel = new Map(opts.types.map((t) => [t.label, t]))
  const mentionType = typeByLabel.get('mentioned')

  // People, in ~12-person communities so edges and circles cluster.
  const people: Person[] = []
  const usedNames = new Set<string>()
  for (let i = 0; i < n; i++) {
    let name = `${pick(FIRST)} ${pick(LAST)}`
    let guard = 0
    while (usedNames.has(name) && guard++ < 50) name = `${pick(FIRST)} ${pick(LAST)}`
    if (usedNames.has(name)) name = `${name} ${i}`
    usedNames.add(name)
    const createdAt = ago(730)
    people.push({
      kind: 'person',
      id: crypto.randomUUID(),
      displayName: name,
      nicknames: chance(0.2) ? [name.split(' ')[0].slice(0, 3)] : [],
      jobTitle: chance(0.7) ? pick(JOBS) : undefined,
      employer: chance(0.5) ? pick(EMPLOYERS) : undefined,
      location: chance(0.6) ? pick(CITIES) : undefined,
      howWeMet: chance(0.4) ? pick(MET) : undefined,
      birthday: chance(0.4)
        ? { month: 1 + Math.floor(rand() * 12), day: 1 + Math.floor(rand() * 28) }
        : undefined,
      likes: Array.from({ length: Math.floor(rand() * 4) }, () => pick(LIKES)).filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
      dislikes: [],
      tags: [
        ...new Set(Array.from({ length: Math.floor(rand() * 3) }, () => pick(TAGS))),
        STRESS_TAG,
      ],
      createdAt,
      updatedAt: createdAt,
    })
  }
  const communitySize = 12
  const communityOf = (i: number) => Math.floor(i / communitySize)
  const communities = Math.ceil(n / communitySize)
  const membersOf = (c: number) =>
    people.slice(c * communitySize, Math.min(n, (c + 1) * communitySize))

  // Explicit edges: 1–3 per person, mostly inside the community.
  const edges: Relationship[] = []
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const linked = new Set<string>()
  const weightedType = (): RelationshipType | undefined => {
    const total = EDGE_TYPES.reduce((s, [, w]) => s + w, 0)
    let r = rand() * total
    for (const [label, w] of EDGE_TYPES) {
      r -= w
      if (r <= 0) return typeByLabel.get(label)
    }
    return typeByLabel.get('friend')
  }
  const addEdge = (from: Person, to: Person, type: RelationshipType | undefined) => {
    if (!type || from.id === to.id) return
    const key = pairKey(from.id, to.id)
    if (linked.has(key)) return
    linked.add(key)
    edges.push({
      kind: 'relationship',
      id: crypto.randomUUID(),
      fromId: from.id,
      toId: to.id,
      typeId: type.id,
      directed: type.directed,
      note: chance(0.15) ? `since ${pick(MET)}` : undefined,
      origin: 'explicit',
      createdAt: ago(700),
    })
  }
  people.forEach((p, i) => {
    const count = 1 + Math.floor(rand() * 3)
    for (let k = 0; k < count; k++) {
      const pool = chance(0.75) ? membersOf(communityOf(i)) : people
      addEdge(p, pick(pool), weightedType())
    }
  })
  // A handful of edges to "me" so how-you-connect has something to walk.
  if (opts.selfId) {
    const me = { id: opts.selfId } as Person
    for (let c = 0; c < communities; c += 2) {
      const anchor = membersOf(c)[0]
      if (anchor) addEdge(me, anchor, typeByLabel.get(chance(0.5) ? 'friend' : 'coworker'))
    }
  }

  // Notes, some mentioning another person (→ dashed mention edges).
  const notes: NoteEntry[] = []
  const perPerson = opts.notesPerPerson ?? 3.3
  const mentionEdges: Relationship[] = []
  for (const [i, p] of people.entries()) {
    const count = Math.round(perPerson * (0.4 + rand() * 1.2))
    const mentionedByP = new Set<string>()
    for (let k = 0; k < count; k++) {
      const template = pick(NOTE_TEMPLATES)
      const mentions: string[] = []
      const body = template
        .replace('{city}', pick(CITIES))
        .replace('{like}', pick(LIKES))
        .replace('{employer}', pick(EMPLOYERS))
        .replace('{mention}', () => {
          const other = pick(chance(0.7) ? membersOf(communityOf(i)) : people)
          if (other.id === p.id) return 'a friend'
          mentions.push(other.id)
          return mentionToken(other)
        })
      notes.push({
        kind: 'note',
        id: crypto.randomUUID(),
        personId: p.id,
        body,
        mentions,
        createdAt: ago(600),
      })
      for (const id of mentions) {
        // Mirror the store's rule: a mention edge only where no explicit
        // edge already joins the pair, and one per (author, mentioned).
        if (mentionType && !linked.has(pairKey(p.id, id)) && !mentionedByP.has(id)) {
          mentionedByP.add(id)
          mentionEdges.push({
            kind: 'relationship',
            id: crypto.randomUUID(),
            fromId: p.id,
            toId: id,
            typeId: mentionType.id,
            directed: true,
            origin: 'mention',
            createdAt: now,
          })
        }
      }
    }
  }

  // Circles: one per community (a subset), plus a few that straddle two.
  const circles: Circle[] = []
  const circleNames = [
    'College friends', 'Choir', 'Book club', 'Five-a-side', 'Old office', 'Neighbours',
    'Climbing crew', 'Wedding table 4', 'Board game night', 'Parents group',
    'Running club', 'Sailing lot', 'Pottery class', 'Cousins', 'Trivia team',
  ]
  const circleCount = Math.max(1, Math.round(n / 15))
  for (let c = 0; c < circleCount; c++) {
    const base = c % communities
    const pool = [...membersOf(base), ...(c % 3 === 2 ? membersOf((base + 1) % communities) : [])]
    const size = Math.min(pool.length, 4 + Math.floor(rand() * 9))
    const memberIds = [...pool]
      .sort(() => rand() - 0.5)
      .slice(0, size)
      .map((p) => p.id)
    const createdAt = ago(500)
    circles.push({
      kind: 'circle',
      id: crypto.randomUUID(),
      name: `${circleNames[c % circleNames.length]}${c >= circleNames.length ? ` ${Math.floor(c / circleNames.length) + 1}` : ''}`,
      color: CIRCLE_COLORS[c % CIRCLE_COLORS.length],
      memberIds,
      createdAt,
      updatedAt: createdAt,
    })
  }

  // Follow-ups for ~10%, a third of them due within the next month.
  const followUps: FollowUp[] = []
  for (const p of people) {
    if (!chance(0.1)) continue
    const due = new Date(now + (chance(0.33) ? Math.floor(rand() * 30) : 60 + Math.floor(rand() * 200)) * 86_400_000)
    followUps.push({
      kind: 'followUp',
      id: crypto.randomUUID(),
      personId: p.id,
      text: pick(FOLLOW_UPS)
        .replace('{like}', pick(LIKES))
        .replace('{employer}', pick(EMPLOYERS))
        .replace('{city}', pick(CITIES)),
      dueDate: chance(0.8)
        ? { year: due.getFullYear(), month: due.getMonth() + 1, day: due.getDate() }
        : undefined,
      done: chance(0.2),
      createdAt: ago(100),
    })
  }

  // Avatars for ~a quarter of the crowd, so the list and graph exercise
  // the photo path (blob decode, clipped drawImage) — not just initials.
  const photos: Photo[] = []
  const blobs: { id: string; bytes: Uint8Array }[] = []
  for (const p of people) {
    if (!chance(0.25)) continue
    const blobRecordId = crypto.randomUUID()
    blobs.push({ id: blobRecordId, bytes: tinyPngBytes() })
    photos.push({
      kind: 'photo',
      id: crypto.randomUUID(),
      personId: p.id,
      isAvatar: true,
      mimeType: 'image/png',
      blobRecordId,
      createdAt: p.createdAt,
    })
  }

  const records: DomainRecord[] = [
    ...people,
    ...edges,
    ...mentionEdges,
    ...notes,
    ...circles,
    ...followUps,
    ...photos,
  ]
  return {
    records,
    blobs,
    counts: {
      people: people.length,
      notes: notes.length,
      edges: edges.length + mentionEdges.length,
      circles: circles.length,
      followUps: followUps.length,
      photos: photos.length,
    },
  }
}

export interface StressResult extends StressCounts {
  /** Wall-clock milliseconds for the bulk write (encrypt + IndexedDB + reindex). */
  ms: number
}

/** Generate and bulk-load a crowd of `n` people into the open vault. */
export async function loadStressCast(n = 300, seed?: number): Promise<StressResult> {
  const state = useVaultStore.getState()
  const built = buildStressRecords(n, {
    types: selectRelationshipTypes(state.records),
    selfId: selectSelf(state.records)?.id,
    seed,
  })
  const t0 = performance.now()
  await state.importRecords(built.records, built.blobs)
  return { ...built.counts, ms: Math.round(performance.now() - t0) }
}

/** Remove everyone the stress loader added (and what hung off them). */
export async function removeStressCast(): Promise<number> {
  const state = useVaultStore.getState()
  const ids = selectPeople(state.records)
    .filter((p) => p.tags.includes(STRESS_TAG))
    .map((p) => p.id)
  if (ids.length === 0) return 0
  await state.removePeople(ids)
  return ids.length
}
