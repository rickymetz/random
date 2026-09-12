/**
 * In-memory decrypted state and domain actions (REQUIREMENTS.md §6.1, §9).
 *
 * Everything here exists only while unlocked. `lock()` is the panic path
 * too: it drops the DEK reference, all decrypted records, and the search
 * index synchronously, and bumps a session epoch so any async write that
 * was in flight when the lock happened discards its result instead of
 * re-populating the store with plaintext. Nothing in this store is
 * persisted directly — writes go through vault.saveRecord(s) and are
 * mirrored here.
 */
import { create } from 'zustand'
import { extractMentions, renameMentionsOf, stripMentionsOf } from '../lib/mentions'
import { linkPhrase } from '../lib/nameDetect'
import { CIRCLE_COLORS, RECENT_LIMIT, type Circle } from '../lib/models'
import {
  BUILT_IN_RELATIONSHIP_TYPES,
  SETTINGS_ID,
  type DomainRecord,
  type FollowUp,
  type NoteEntry,
  type PartialDate,
  type Person,
  type Photo,
  type Relationship,
  type RelationshipType,
  type Settings,
} from '../lib/models'
import { wipe } from '../lib/crypto'
import {
  armPin,
  disarmPin,
  pinArmed,
  pinAttemptsLeft,
  pinLength,
  takeFailedAttemptsReport,
  tryPinUnlock,
} from '../lib/pin'
import { clearPhotoCache, evictPhoto } from '../lib/photoCache'
import { createIndex, rebuildIndex, reindexPerson, searchPeople } from '../lib/search'
import { sanitizeRecords } from '../lib/validate'
import {
  createVault,
  deleteBlobs,
  deleteRecords,
  loadAllRecords,
  saveBlob,
  saveRecords,
  sweepOrphanBlobs,
  unlockVault,
  unlockWithRawDek,
  unwrapRawDek,
  vaultExists,
  type UnlockedVault,
} from '../lib/vault'
import {
  biometricEnrollments,
  biometricUnlock,
  enrollBiometric as webAuthnEnroll,
  isUserCancel,
  removeBiometricEnrollment,
  removeBiometricEnrollments,
} from '../lib/webauthn'

// Module-level so it never renders and dies with lock(); rebuilt on unlock.
let searchIndex = createIndex()

// Import caps: photos bypass the local downscale pipeline, so a hostile
// bundle must not be able to store decompression bombs or eat the quota.
const MAX_IMPORT_BLOB_BYTES = 8 * 1024 * 1024
const MAX_IMPORT_BLOB_TOTAL = 100 * 1024 * 1024

interface VaultState {
  status: 'unknown' | 'no-vault' | 'locked' | 'unlocked'
  vault: UnlockedVault | null
  records: Map<string, DomainRecord>
  /** Bumped on every lock; async work from an older epoch discards itself. */
  epoch: number
  /** Rows that failed to decrypt at unlock — surfaced, not fatal. */
  corrupted: number
  /**
   * The vault opened via a biometric/PIN path but still carries the
   * legacy PBKDF2 wrap — only a passphrase unlock can migrate it (§6.2).
   */
  kdfLegacy: boolean
  /** Home-screen search query, preserved across navigation (memory only). */
  homeQuery: string
  /** People-list paging window, kept across a dossier visit like the query. */
  homePage: { key: string; limit: number }

  /** Quick re-unlock PIN armed for this browser session (§6.3). */
  pinArmed: boolean
  pinAttemptsLeft: number
  /** Armed PIN's digit count (memory only), for unlock auto-submit. */
  pinDigits: number
  /** The PIN was disarmed by too many wrong tries (shown at unlock). */
  pinLockedOut: boolean
  /** Failed PIN guesses since the previous successful unlock (tamper signal). */
  pinFailureNotice: number
  /** At least one biometric (WebAuthn PRF) enrollment exists. */
  biometricEnrolled: boolean

  init: () => Promise<void>
  create: (passphrase: string) => Promise<void>
  unlock: (passphrase: string) => Promise<boolean>
  unlockWithPin: (pin: string) => Promise<'ok' | 'wrong' | 'stale'>
  unlockWithBiometric: () => Promise<boolean>
  /** Timer-driven lock: drops all decrypted state; the session PIN stays. */
  lock: () => void
  /** Panic lock (§6.4): everything lock() drops PLUS the PIN session. */
  panicLock: () => void
  /** Drop the session PIN so only passphrase/biometric unlock remain. */
  forgetPin: () => void
  clearPinFailureNotice: () => void
  setPin: (pin: string, passphrase: string) => Promise<boolean>
  enrollBiometric: (
    passphrase: string,
  ) => Promise<'ok' | 'unsupported' | 'wrong-passphrase' | 'cancelled'>
  removeBiometric: () => Promise<void>
  updateSecurity: (
    patch: Partial<
      Pick<
        Settings,
        | 'autoLockMinutes'
        | 'backgroundGraceSeconds'
        | 'shakeToLock'
        | 'remindersEnabled'
        | 'lastReminderDay'
      >
    >,
  ) => Promise<void>
  /** Capture-draft registry: auto-locks flush drafts into notes first. */
  registerDraft: (personId: string, read: () => string) => void
  unregisterDraft: (personId: string) => void
  flushDrafts: () => Promise<void>
  setHomeQuery: (query: string) => void
  setHomePage: (page: { key: string; limit: number }) => void

  addPerson: (displayName: string) => Promise<Person>
  /** Several people in one encrypted write ("Add several"). */
  addPeople: (displayNames: string[]) => Promise<Person[]>
  /** Several explicit edges in one write; each replaces a mention edge on its pair. */
  addRelationships: (edges: { fromId: string; toId: string; typeId: string }[]) => Promise<void>
  updatePerson: (person: Person) => Promise<void>
  removePerson: (personId: string) => Promise<void>
  /** Bulk delete; circles left with no members are removed too. */
  removePeople: (personIds: string[]) => Promise<void>
  saveNote: (personId: string, body: string) => Promise<NoteEntry | undefined>
  /**
   * "Looks like people": turn plain names in a note into @mentions. Each
   * link names a phrase and either an existing person or (no personId) a
   * new one called after the phrase. One encrypted write; mention edges
   * follow the rewritten text. Returns the people linked, in order.
   */
  linkNamesInNote: (noteId: string, links: { phrase: string; personId?: string }[]) => Promise<Person[]>
  removeNote: (noteId: string) => Promise<void>
  updateNote: (noteId: string, body: string) => Promise<void>
  /** Circles (§4.6): named, colored groups drawn as bubbles on the graph. */
  addCircle: (name: string, color?: string) => Promise<Circle>
  /** Resolves 'name-taken' (nothing written) if another circle has that name. */
  updateCircle: (circle: Circle) => Promise<'ok' | 'name-taken'>
  removeCircle: (circleId: string) => Promise<void>
  /** Replace the set of circles a person belongs to. */
  setPersonCircles: (personId: string, circleIds: string[]) => Promise<void>
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
  addRelationshipType: (
    label: string,
    color: string,
    directed: boolean,
  ) => Promise<RelationshipType>
  markExported: () => Promise<void>
  /** Remember a dossier was opened (the home screen's Recent row). */
  noteVisit: (personId: string) => Promise<void>
  importRecords: (
    incoming: unknown,
    blobs?: { id: string; bytes: Uint8Array }[],
  ) => Promise<number>

  addPhotoBytes: (
    personId: string,
    bytes: Uint8Array,
    mimeType: string,
    isAvatar: boolean,
  ) => Promise<void>
  removePhoto: (photoId: string) => Promise<void>
  setAvatarPhoto: (photoId: string) => Promise<void>
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
 * have an outgoing mention-origin edge to exactly the people their notes
 * mention who aren't connected to A by an EXPLICIT edge. Only A's own
 * outgoing mention edges are managed here — an incoming mention edge
 * (B→A) belongs to B's notes and neither blocks A's edge nor gets
 * touched. Returns the puts/deletes to apply, without touching state.
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

  const explicitlyRelated = new Set<string>()
  const ownMentionEdges: Relationship[] = []
  for (const r of records.values()) {
    if (r.kind !== 'relationship') continue
    if (r.origin === 'mention') {
      if (r.fromId === personId) ownMentionEdges.push(r)
    } else if (r.fromId === personId || r.toId === personId) {
      explicitlyRelated.add(r.fromId === personId ? r.toId : r.fromId)
    }
  }

  const deletes: string[] = []
  const covered = new Set<string>()
  for (const edge of ownMentionEdges) {
    if (!mentioned.has(edge.toId) || explicitlyRelated.has(edge.toId) || covered.has(edge.toId)) {
      deletes.push(edge.id)
    } else {
      covered.add(edge.toId)
    }
  }
  const puts: Relationship[] = []
  for (const id of mentioned) {
    if (explicitlyRelated.has(id) || covered.has(id)) continue
    const target = records.get(id)
    if (!target || target.kind !== 'person') continue
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

// All mutations run through one chain so two in-flight actions can never
// diff against the same stale snapshot (double-tap → duplicate edges).
let writeChain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.catch(() => undefined)
  return run
}

export const useVaultStore = create<VaultState>((set, get) => {
  /**
   * Persist and mirror a batch of puts/deletes, then refresh search docs.
   * If a lock happened while the encrypted write was in flight (epoch
   * changed), the decrypted result is discarded — the store must stay
   * empty after lock (§6.4). Disk writes that already landed are
   * ciphertext, so they are safe either way.
   */
  async function apply(
    puts: DomainRecord[],
    deletes: string[] = [],
    reindexIds: string[] = [],
  ): Promise<void> {
    // A write that starts after a lock is a silent no-op: the panic path
    // wins, and nothing may throw or repopulate memory.
    const vault = get().vault
    if (!vault) return
    const startEpoch = get().epoch
    if (puts.length > 0) await saveRecords(vault, puts)
    if (deletes.length > 0) await deleteRecords(vault, deletes)
    if (get().epoch !== startEpoch || get().vault !== vault) return
    const next = new Map(get().records)
    for (const record of puts) next.set(record.id, record)
    for (const id of deletes) next.delete(id)
    set({ records: next })
    for (const id of reindexIds) reindexPerson(searchIndex, next, id)
  }

  /**
   * Load + sanitize records and enter the unlocked state. Epoch-guarded
   * like every other plaintext repopulation: a lock that lands mid-load
   * wins, and the loaded records are discarded.
   */
  async function finishUnlock(vault: UnlockedVault): Promise<boolean> {
    const startEpoch = get().epoch
    const { records: loaded, corrupted } = await loadAllRecords(vault)
    // Defense in depth: stored records went through sanitize on the way
    // in, but a bad row must not brick unlock (§5 T2 aftermath).
    const { records: clean } = sanitizeRecords(loaded)
    const records = new Map(clean.map((r) => [r.id, r]))
    const seed = missingBuiltInTypes(records)
    if (seed.length > 0) {
      await saveRecords(vault, seed)
      for (const t of seed) records.set(t.id, t)
    }
    if (get().epoch !== startEpoch || get().status === 'unlocked') return false
    // Sweep blob rows stranded by lock-raced photo writes/deletes.
    const referencedBlobs = new Set<string>()
    for (const r of records.values()) {
      if (r.kind === 'photo') referencedBlobs.add(r.blobRecordId)
    }
    await sweepOrphanBlobs(vault, referencedBlobs)
    if (get().epoch !== startEpoch || get().status === 'unlocked') return false
    searchIndex = createIndex()
    rebuildIndex(searchIndex, records)
    set({
      status: 'unlocked',
      vault,
      records,
      corrupted,
      kdfLegacy: vault.kdfLegacy ?? false,
      pinArmed: pinArmed(),
      pinAttemptsLeft: pinAttemptsLeft(),
      pinDigits: pinLength(),
      pinLockedOut: false,
      // Tamper signal: failed PIN guesses while the owner was away (§6.3).
      pinFailureNotice: takeFailedAttemptsReport(),
    })
    return true
  }

  // Capture drafts to flush into notes before a timer-driven lock (§6.3).
  const draftRegistry = new Map<string, () => string>()

  function baseLock(): void {
    searchIndex = createIndex()
    // Decrypted image object-URLs are plaintext too (§6.1).
    clearPhotoCache()
    set((state) => ({
      status: state.status === 'no-vault' ? 'no-vault' : 'locked',
      vault: null,
      records: new Map(),
      epoch: state.epoch + 1,
      homeQuery: '',
      homePage: { key: '', limit: 0 },
      pinArmed: pinArmed(),
      pinAttemptsLeft: pinAttemptsLeft(),
      pinDigits: pinLength(),
    }))
  }


  /**
   * Delete people and everything that hangs off them (notes, follow-ups,
   * photos, edges, circle memberships, dangling @mentions elsewhere) in
   * ONE write. `dropEmptiedCircles` (bulk removal of a whole cast) also
   * deletes circles whose every member was removed — a one-off delete
   * keeps the now-emptier circle, as before.
   */
  async function removePeopleImpl(
    personIds: string[],
    dropEmptiedCircles: boolean,
  ): Promise<void> {
    const { records } = get()
    const gone = new Set(personIds.filter((id) => records.get(id)?.kind === 'person'))
    if (gone.size === 0) return
    const deletes = [...gone]
    const puts: DomainRecord[] = []
    const touched = new Set<string>(gone)
    const blobIds: string[] = []
    for (const r of records.values()) {
      if (
        ((r.kind === 'note' || r.kind === 'followUp' || r.kind === 'photo') &&
          gone.has(r.personId)) ||
        (r.kind === 'relationship' && (gone.has(r.fromId) || gone.has(r.toId)))
      ) {
        deletes.push(r.id)
        if (r.kind === 'photo') blobIds.push(r.blobRecordId)
      } else if (r.kind === 'circle' && r.memberIds.some((m) => gone.has(m))) {
        const memberIds = r.memberIds.filter((m) => !gone.has(m))
        if (dropEmptiedCircles && memberIds.length === 0) deletes.push(r.id)
        else puts.push({ ...r, memberIds })
      } else if (r.kind === 'settings' && r.recentIds?.some((id) => gone.has(id))) {
        puts.push({ ...r, recentIds: r.recentIds.filter((id) => !gone.has(id)) })
      } else if (r.kind === 'note' && r.mentions.some((m) => gone.has(m))) {
        // Rewrite dangling mention tokens in other people's notes to the
        // plain name, so no dead @links survive the delete.
        let body = r.body
        for (const m of r.mentions) if (gone.has(m)) body = stripMentionsOf(body, m)
        puts.push({ ...r, body, mentions: r.mentions.filter((m) => !gone.has(m)) })
        touched.add(r.personId)
      }
    }
    // Capture before apply: a lock mid-write must not strand blobs.
    const vaultForBlobs = get().vault
    // Reindexing per person is O(records) each; past a handful, one
    // rebuild is cheaper.
    if (touched.size > 20) {
      await apply(puts, deletes)
      if (get().vault === vaultForBlobs && get().status === 'unlocked') {
        rebuildIndex(searchIndex, get().records)
      }
    } else {
      await apply(puts, deletes, [...touched])
    }
    if (vaultForBlobs && blobIds.length > 0) {
      await deleteBlobs(vaultForBlobs, blobIds)
      for (const id of blobIds) evictPhoto(id)
    }
  }

  return {
    status: 'unknown',
    vault: null,
    records: new Map(),
    epoch: 0,
    corrupted: 0,
    kdfLegacy: false,
    homeQuery: '',
    homePage: { key: '', limit: 0 },
    pinArmed: false,
    pinAttemptsLeft: 0,
    pinDigits: 0,
    pinLockedOut: false,
    pinFailureNotice: 0,
    biometricEnrolled: false,

    init: async () => {
      const [exists, enrollments] = await Promise.all([vaultExists(), biometricEnrollments()])
      set({
        status: exists ? 'locked' : 'no-vault',
        biometricEnrolled: enrollments.length > 0,
        pinArmed: pinArmed(),
        pinAttemptsLeft: pinAttemptsLeft(),
        pinDigits: pinLength(),
      })
    },

    create: async (passphrase) => {
      const startEpoch = get().epoch
      const vault = await createVault(passphrase)
      const records = new Map<string, DomainRecord>()
      const seed: DomainRecord[] = missingBuiltInTypes(records)
      // The "me" node (§4.4, §11 Q2): graph queries like "how do I know
      // X" need an anchor, so every vault starts with one.
      const me: Person = {
        kind: 'person',
        id: crypto.randomUUID(),
        displayName: 'Me',
        nicknames: [],
        likes: [],
        dislikes: [],
        tags: [],
        isSelf: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      seed.push(me)
      await saveRecords(vault, seed)
      for (const t of seed) records.set(t.id, t)
      if (get().epoch !== startEpoch) return
      searchIndex = createIndex()
      rebuildIndex(searchIndex, records)
      set({ status: 'unlocked', vault, records, corrupted: 0 })
    },

    unlock: async (passphrase) => {
      if (get().status === 'unlocked') return true
      const vault = await unlockVault(passphrase)
      if (!vault) return false
      return finishUnlock(vault)
    },

    unlockWithPin: async (pin) => {
      if (get().status === 'unlocked') return 'ok'
      const result = await tryPinUnlock(pin)
      if (!result.ok) {
        set({
          pinArmed: pinArmed(),
          pinAttemptsLeft: result.attemptsLeft,
          pinLockedOut: !pinArmed(),
        })
        return 'wrong'
      }
      const vault = await unlockWithRawDek(result.rawDek)
      if (!vault) {
        // The PIN was RIGHT but its DEK opens no slot (vault replaced by a
        // restore, corrupted slots). Don't call it wrong, don't loop —
        // drop the stale session so the passphrase path takes over.
        disarmPin()
        set({ pinArmed: false, pinAttemptsLeft: 0, pinDigits: 0 })
        return 'stale'
      }
      return (await finishUnlock(vault)) ? 'ok' : 'stale'
    },

    unlockWithBiometric: async () => {
      if (get().status === 'unlocked') return true
      const rawDek = await biometricUnlock()
      if (!rawDek) return false
      const vault = await unlockWithRawDek(rawDek)
      if (!vault) return false
      return finishUnlock(vault)
    },

    lock: () => {
      // Timer-driven lock: the session PIN stays armed — quick re-unlock
      // is its purpose; the attempt limit and tab lifetime bound the
      // exposure (§6.3).
      baseLock()
    },

    panicLock: () => {
      // Panic (§6.4): nothing PIN-openable may remain in memory.
      disarmPin()
      baseLock()
    },

    forgetPin: () => {
      disarmPin()
      set({ pinArmed: false, pinAttemptsLeft: 0, pinDigits: 0 })
    },

    clearPinFailureNotice: () => set({ pinFailureNotice: 0 }),

    setPin: async (pin, passphrase) => {
      const vault = get().vault
      if (!vault) return false
      const startEpoch = get().epoch
      const unwrapped = await unwrapRawDek(passphrase)
      if (!unwrapped) return false
      try {
        // Bind to the OPEN vault only: accepting another slot's passphrase
        // would silently arm quick-unlock for a different vault (§6.6).
        if (unwrapped.slotId !== vault.slotId) return false
        if (get().epoch !== startEpoch) return false
        await armPin(pin, unwrapped.rawDek)
        set({ pinArmed: true, pinAttemptsLeft: pinAttemptsLeft(), pinDigits: pinLength(), pinLockedOut: false })
        return true
      } finally {
        wipe(unwrapped.rawDek)
      }
    },

    enrollBiometric: async (passphrase) => {
      const vault = get().vault
      if (!vault) return 'wrong-passphrase'
      const startEpoch = get().epoch
      const unwrapped = await unwrapRawDek(passphrase)
      if (!unwrapped) return 'wrong-passphrase'
      try {
        // Same slot-binding rule as setPin (§6.6).
        if (unwrapped.slotId !== vault.slotId) return 'wrong-passphrase'
        const result = await webAuthnEnroll(unwrapped.rawDek)
        if (result.status !== 'ok') return 'unsupported'
        if (get().epoch !== startEpoch) {
          // A panic lock happened while the platform sheet was up: a
          // persistent unlock credential created after a panic must not
          // survive it.
          await removeBiometricEnrollment(result.credentialId)
          return 'cancelled'
        }
        set({ biometricEnrolled: true })
        return 'ok'
      } catch (error) {
        return isUserCancel(error) ? 'cancelled' : 'unsupported'
      } finally {
        wipe(unwrapped.rawDek)
      }
    },

    removeBiometric: async () => {
      await removeBiometricEnrollments()
      set({ biometricEnrolled: false })
    },

    registerDraft: (personId, read) => {
      draftRegistry.set(personId, read)
    },

    unregisterDraft: (personId) => {
      draftRegistry.delete(personId)
    },

    flushDrafts: async () => {
      const drafts = [...draftRegistry.entries()]
      for (const [personId, read] of drafts) {
        const body = read().trim()
        if (body && get().records.has(personId)) {
          await get().saveNote(personId, body)
        }
        draftRegistry.delete(personId)
      }
    },

    updateSecurity: (patch) =>
      enqueue(async () => {
        const existing = get().records.get(SETTINGS_ID)
        const settings: Settings = {
          ...(existing?.kind === 'settings' ? existing : {}),
          kind: 'settings',
          id: SETTINGS_ID,
          ...patch,
        }
        await apply([settings])
      }),

    setHomeQuery: (homeQuery) => set({ homeQuery }),
    setHomePage: (homePage) => set({ homePage }),

    addPerson: (displayName) =>
      enqueue(async () => {
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
    }),

    addPeople: (displayNames) =>
      enqueue(async () => {
      const now = Date.now()
      const people: Person[] = displayNames.map((displayName) => ({
        kind: 'person',
        id: crypto.randomUUID(),
        displayName: displayName.trim() || 'Unnamed',
        nicknames: [],
        likes: [],
        dislikes: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      }))
      if (people.length > 0) await apply(people, [], people.map((p) => p.id))
      return people
    }),

    addRelationships: (edges) =>
      enqueue(async () => {
      const { records } = get()
      const puts: Relationship[] = []
      const deletes: string[] = []
      const touched = new Set<string>()
      // Pairs already joined by an explicit edge are left alone: a batch
      // must never stack a second link on someone you already linked.
      const pairs = new Set<string>()
      for (const r of records.values()) {
        if (r.kind === 'relationship' && r.origin !== 'mention') {
          pairs.add([r.fromId, r.toId].sort().join('|'))
        }
      }
      for (const e of edges) {
        const type = records.get(e.typeId)
        if (!type || type.kind !== 'relationshipType') continue
        if (!records.has(e.fromId) || !records.has(e.toId) || e.fromId === e.toId) continue
        const key = [e.fromId, e.toId].sort().join('|')
        if (pairs.has(key)) continue
        pairs.add(key)
        for (const r of records.values()) {
          if (
            r.kind === 'relationship' &&
            r.origin === 'mention' &&
            ((r.fromId === e.fromId && r.toId === e.toId) ||
              (r.fromId === e.toId && r.toId === e.fromId))
          ) {
            deletes.push(r.id)
          }
        }
        puts.push({
          kind: 'relationship',
          id: crypto.randomUUID(),
          fromId: e.fromId,
          toId: e.toId,
          typeId: e.typeId,
          directed: type.directed,
          origin: 'explicit',
          createdAt: Date.now(),
        })
        touched.add(e.fromId)
        touched.add(e.toId)
      }
      if (puts.length > 0 || deletes.length > 0) await apply(puts, deletes, [...touched])
    }),

    updatePerson: (person) =>
      enqueue(async () => {
      const puts: DomainRecord[] = [{ ...person, updatedAt: Date.now() }]
      const reindex = new Set<string>([person.id])
      // At most one self: claiming "this is me" demotes the previous one.
      if (person.isSelf) {
        for (const r of get().records.values()) {
          if (r.kind === 'person' && r.isSelf && r.id !== person.id) {
            puts.push({ ...r, isSelf: undefined })
            reindex.add(r.id)
          }
        }
      }
      // A rename rewrites the label inside every note that mentions this
      // person, so "@Old Name" never lingers in someone else's timeline.
      const before = get().records.get(person.id)
      if (before?.kind === 'person' && before.displayName !== person.displayName) {
        for (const r of get().records.values()) {
          if (r.kind === 'note' && r.mentions.includes(person.id)) {
            puts.push({ ...r, body: renameMentionsOf(r.body, person.id, person.displayName) })
            reindex.add(r.personId)
          }
        }
      }
      await apply(puts, [], [...reindex])
    }),

    removePerson: (personId) =>
      enqueue(() => removePeopleImpl([personId], false)),

    removePeople: (personIds) => enqueue(() => removePeopleImpl(personIds, true)),

    saveNote: (personId, body) =>
      enqueue(async () => {
      // Never resurrect a deleted person: a draft flushed while the
      // person is being removed would persist an orphaned note (unseen
      // in every UI, yet carried in exports).
      if (!get().records.has(personId)) return
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
      return note
    }),

    linkNamesInNote: (noteId, links) =>
      enqueue(async () => {
      const note = get().records.get(noteId)
      if (!note || note.kind !== 'note') return []
      const now = Date.now()
      const created: Person[] = []
      const linked: Person[] = []
      let body = note.body
      for (const link of links) {
        const phrase = link.phrase.trim()
        if (!phrase) continue
        let target: Person | undefined
        if (link.personId) {
          const r = get().records.get(link.personId)
          if (r?.kind === 'person') target = r
        } else {
          target = {
            kind: 'person',
            id: crypto.randomUUID(),
            displayName: phrase,
            nicknames: [],
            likes: [],
            dislikes: [],
            tags: [],
            createdAt: now,
            updatedAt: now,
          }
          created.push(target)
        }
        if (!target || target.id === note.personId) continue
        const next = linkPhrase(body, phrase, target)
        if (next === body) continue
        body = next
        linked.push(target)
      }
      if (body === note.body) return []
      // Only people whose phrase was actually found get created.
      const kept = created.filter((p) => linked.includes(p))
      const edited: NoteEntry = { ...note, body, mentions: extractMentions(body) }
      const withEdit = new Map(get().records)
      for (const p of kept) withEdit.set(p.id, p)
      withEdit.set(noteId, edited)
      const { puts, deletes } = diffMentionEdges(withEdit, note.personId)
      await apply([...kept, edited, ...puts], deletes, [note.personId, ...kept.map((p) => p.id)])
      return linked
    }),

    updateNote: (noteId, body) =>
      enqueue(async () => {
      const note = get().records.get(noteId)
      if (!note || note.kind !== 'note') return
      const edited: NoteEntry = { ...note, body, mentions: extractMentions(body) }
      const withEdit = new Map(get().records)
      withEdit.set(noteId, edited)
      // Mention edges follow the text exactly as they do on save/delete.
      const { puts, deletes } = diffMentionEdges(withEdit, note.personId)
      await apply([edited, ...puts], deletes, [note.personId])
    }),

    removeNote: (noteId) =>
      enqueue(async () => {
      const note = get().records.get(noteId)
      if (!note || note.kind !== 'note') return
      const without = new Map(get().records)
      without.delete(noteId)
      const { puts, deletes } = diffMentionEdges(without, note.personId)
      await apply(puts, [noteId, ...deletes], [note.personId])
    }),

    addFollowUp: (personId, text, dueDate) =>
      enqueue(async () => {
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
    }),

    toggleFollowUp: (followUpId) =>
      enqueue(async () => {
      const f = get().records.get(followUpId)
      if (!f || f.kind !== 'followUp') return
      await apply([{ ...f, done: !f.done }])
    }),

    removeFollowUp: (followUpId) =>
      enqueue(async () => {
      await apply([], [followUpId])
    }),

    addRelationship: (fromId, toId, typeId, note) =>
      enqueue(async () => {
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
      await apply([edge], deletes, [fromId, toId])
    }),

    removeRelationship: (relationshipId) =>
      enqueue(async () => {
      const edge = get().records.get(relationshipId)
      if (!edge || edge.kind !== 'relationship') return
      // If notes still mention the pair, derived edges come back — for
      // BOTH endpoints, since either side's notes may hold the mention.
      const without = new Map(get().records)
      without.delete(relationshipId)
      const fromDiff = diffMentionEdges(without, edge.fromId)
      for (const p of fromDiff.puts) without.set(p.id, p)
      const toDiff = diffMentionEdges(without, edge.toId)
      await apply(
        [...fromDiff.puts, ...toDiff.puts],
        [relationshipId, ...fromDiff.deletes, ...toDiff.deletes],
        [edge.fromId, edge.toId],
      )
    }),

    addRelationshipType: (label, color, directed) =>
      enqueue(async () => {
      const trimmed = label.trim()
      // Reuse an existing type with the same label instead of silently
      // creating an indistinguishable duplicate.
      for (const r of get().records.values()) {
        if (
          r.kind === 'relationshipType' &&
          r.label.toLowerCase() === trimmed.toLowerCase()
        ) {
          return r
        }
      }
      const type: RelationshipType = {
        kind: 'relationshipType',
        id: crypto.randomUUID(),
        label: trimmed,
        color,
        directed,
        builtIn: false,
      }
      await apply([type])
      return type
    }),

    addCircle: (name, color) =>
      enqueue(async () => {
        const trimmed = name.trim()
        const all = selectCircles(get().records)
        const existing = all.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
        if (existing) return existing
        // Least-used hue (palette order breaks ties), so the 9th circle
        // never lands on an exact duplicate of the 1st.
        const counts = new Map(CIRCLE_COLORS.map((c) => [c, 0]))
        for (const c of all) counts.set(c.color, (counts.get(c.color) ?? 0) + 1)
        const auto = CIRCLE_COLORS.reduce((best, c) =>
          (counts.get(c) ?? 0) < (counts.get(best) ?? 0) ? c : best,
        )
        const circle: Circle = {
          kind: 'circle',
          id: crypto.randomUUID(),
          name: trimmed,
          color: color ?? auto,
          memberIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await apply([circle], [], [])
        return circle
      }),

    updateCircle: (circle) =>
      enqueue(async () => {
        const before = get().records.get(circle.id)
        if (before?.kind !== 'circle') return 'ok' as const
        const wanted = circle.name.trim().toLowerCase()
        const clash = selectCircles(get().records).some(
          (c) => c.id !== circle.id && c.name.toLowerCase() === wanted,
        )
        if (clash) return 'name-taken' as const
        const next: Circle = {
          ...circle,
          name: circle.name.trim() || before.name,
          memberIds: [...new Set(circle.memberIds)].filter((id) => get().records.has(id)),
          updatedAt: Date.now(),
        }
        // Circle names are searchable: reindex anyone whose membership or
        // circle name changed.
        await apply([next], [], [...new Set([...before.memberIds, ...next.memberIds])])
        return 'ok' as const
      }),

    removeCircle: (circleId) =>
      enqueue(async () => {
        const circle = get().records.get(circleId)
        if (circle?.kind !== 'circle') return
        // Only the grouping goes; the people are untouched.
        await apply([], [circleId], [...circle.memberIds])
      }),

    setPersonCircles: (personId, circleIds) =>
      enqueue(async () => {
        if (!get().records.has(personId)) return
        const want = new Set(circleIds)
        const puts: DomainRecord[] = []
        for (const c of selectCircles(get().records)) {
          const has = c.memberIds.includes(personId)
          if (want.has(c.id) && !has) {
            puts.push({ ...c, memberIds: [...c.memberIds, personId], updatedAt: Date.now() })
          } else if (!want.has(c.id) && has) {
            puts.push({
              ...c,
              memberIds: c.memberIds.filter((m) => m !== personId),
              updatedAt: Date.now(),
            })
          }
        }
        if (puts.length > 0) await apply(puts, [], [personId])
      }),

    noteVisit: (personId) =>
      enqueue(async () => {
        const { records } = get()
        const person = records.get(personId)
        // Yourself isn't a "recent contact"; a vanished person isn't either.
        if (!person || person.kind !== 'person' || person.isSelf) return
        const existing = records.get(SETTINGS_ID)
        const current = existing?.kind === 'settings' ? (existing.recentIds ?? []) : []
        if (current[0] === personId) return
        const settings: Settings = {
          ...(existing?.kind === 'settings' ? existing : {}),
          kind: 'settings',
          id: SETTINGS_ID,
          recentIds: [personId, ...current.filter((id) => id !== personId)].slice(0, RECENT_LIMIT),
        }
        await apply([settings])
      }),

    markExported: () =>
      enqueue(async () => {
      const existing = get().records.get(SETTINGS_ID)
      const settings: Settings = {
        ...(existing?.kind === 'settings' ? existing : {}),
        kind: 'settings',
        id: SETTINGS_ID,
        lastExportAt: Date.now(),
      }
      await apply([settings])
    }),

    importRecords: (incoming, blobs = []) =>
      enqueue(async () => {
      const vault = get().vault
      if (!vault) return 0
      const startEpoch = get().epoch
      const { records: sanitized } = sanitizeRecords(incoming)

      // Imported built-in types are matched by label so a restore doesn't
      // duplicate the seeded vocabulary. Records are cloned before any
      // remap so the caller's array is never mutated.
      const current = get().records
      const builtInByLabel = new Map(
        [...current.values()]
          .filter((r): r is RelationshipType => r.kind === 'relationshipType' && r.builtIn)
          .map((r) => [r.label, r.id]),
      )
      const idRemap = new Map<string, string>()
      // Map every built-in type BEFORE any relationship is remapped: bundle
      // rows arrive in arbitrary key order, so a relationship that precedes
      // its type record would otherwise keep a dangling typeId — and every
      // "partner" would read as "linked" after a restore.
      for (const record of sanitized) {
        if (record.kind === 'relationshipType' && record.builtIn) {
          const existingId = builtInByLabel.get(record.label)
          if (existingId && existingId !== record.id) idRemap.set(record.id, existingId)
        }
      }
      const puts: DomainRecord[] = []
      const blobBytesById = new Map(blobs.map((b) => [b.id, b.bytes]))
      const blobWrites: { id: string; bytes: Uint8Array }[] = []
      let blobBudget = MAX_IMPORT_BLOB_TOTAL
      for (const record of sanitized) {
        // Settings are device-local preferences; a bundle must never be
        // able to rewrite them (a crafted backup could otherwise disable
        // the auto-lock — the primary T1 mitigation).
        if (record.kind === 'settings') continue
        if (record.kind === 'relationshipType' && record.builtIn) {
          const existingId = builtInByLabel.get(record.label)
          if (existingId && existingId !== record.id) {
            idRemap.set(record.id, existingId)
            continue
          }
        }
        if (record.kind === 'photo') {
          // Photos import only when their bytes came along, under fresh
          // blob ids — an imported id can never overwrite an existing
          // blob or be shared between records — and within size caps.
          const bytes = blobBytesById.get(record.blobRecordId)
          if (!bytes || bytes.length > MAX_IMPORT_BLOB_BYTES) continue
          if (blobBudget - bytes.length < 0) continue
          blobBudget -= bytes.length
          const freshBlobId = crypto.randomUUID()
          blobWrites.push({ id: freshBlobId, bytes })
          puts.push({ ...record, blobRecordId: freshBlobId })
          continue
        }
        puts.push(
          record.kind === 'relationship'
            ? { ...record, typeId: idRemap.get(record.typeId) ?? record.typeId }
            : { ...record },
        )
      }
      // One avatar per person, even when the bundle disagrees with the
      // existing records: keep the incoming avatar, demote the rest.
      const merged = new Map(get().records)
      for (const record of puts) merged.set(record.id, record)
      const avatarSeen = new Set<string>()
      const putIds = new Set(puts.map((p) => p.id))
      for (const record of puts) {
        if (record.kind === 'photo' && record.isAvatar) avatarSeen.add(record.personId)
      }
      for (const [rid, record] of merged) {
        if (record.kind !== 'photo' || !record.isAvatar) continue
        const isIncoming = putIds.has(rid)
        if (avatarSeen.has(record.personId) && !isIncoming) {
          puts.push({ ...record, isAvatar: false })
          merged.set(rid, { ...record, isAvatar: false })
        }
      }
      // Same for the single-self invariant (§4.4): restoring your backup
      // into a fresh vault must not leave both the seeded "Me" and your
      // real self flagged. The incoming self wins; existing ones demote.
      const incomingSelf = puts.find((r) => r.kind === 'person' && r.isSelf)
      if (incomingSelf) {
        for (const [rid, record] of merged) {
          if (
            record.kind === 'person' &&
            record.isSelf &&
            rid !== incomingSelf.id &&
            !putIds.has(rid)
          ) {
            const demoted = { ...record, isSelf: undefined }
            puts.push(demoted)
            merged.set(rid, demoted)
          }
        }
        // A bundle with multiple selves keeps only the first.
        let kept = false
        for (const record of puts) {
          if (record.kind === 'person' && record.isSelf) {
            if (kept) record.isSelf = undefined
            kept = true
          }
        }
      }
      await saveRecords(vault, puts)
      for (const blob of blobWrites) await saveBlob(vault, blob.id, blob.bytes)
      if (get().epoch !== startEpoch || get().vault !== vault) return puts.length
      // Merge onto the CURRENT records — writes that landed during the
      // import must not be lost from memory.
      const records = new Map(get().records)
      for (const record of puts) records.set(record.id, record)
      set({ records })
      rebuildIndex(searchIndex, records)
      return puts.length
    }),

    addPhotoBytes: (personId, bytes, mimeType, isAvatar) =>
      enqueue(async () => {
        const vault = get().vault
        if (!vault) return
        const blobRecordId = crypto.randomUUID()
        await saveBlob(vault, blobRecordId, bytes)
        const photo: Photo = {
          kind: 'photo',
          id: crypto.randomUUID(),
          personId,
          isAvatar,
          mimeType,
          blobRecordId,
          createdAt: Date.now(),
        }
        // Only one avatar per person: demote any existing one.
        const puts: DomainRecord[] = [photo]
        if (isAvatar) {
          for (const r of get().records.values()) {
            if (r.kind === 'photo' && r.personId === personId && r.isAvatar) {
              puts.push({ ...r, isAvatar: false })
            }
          }
        }
        await apply(puts)
      }),

    removePhoto: (photoId) =>
      enqueue(async () => {
        const photo = get().records.get(photoId)
        if (!photo || photo.kind !== 'photo') return
        // Capture the vault now: a lock during apply must not strand the
        // blob on disk (encrypted deletes are safe post-lock).
        const vault = get().vault
        if (!vault) return
        // Deleting the avatar hands the role to the oldest remaining
        // photo — a person with photos should never silently lose their
        // face everywhere.
        const puts: DomainRecord[] = []
        if (photo.isAvatar) {
          const successor = selectPhotos(get().records, photo.personId).find(
            (p) => p.id !== photoId,
          )
          if (successor) puts.push({ ...successor, isAvatar: true })
        }
        await apply(puts, [photoId])
        await deleteBlobs(vault, [photo.blobRecordId])
        evictPhoto(photo.blobRecordId)
      }),

    setAvatarPhoto: (photoId) =>
      enqueue(async () => {
        const photo = get().records.get(photoId)
        if (!photo || photo.kind !== 'photo') return
        const puts: DomainRecord[] = [{ ...photo, isAvatar: true }]
        for (const r of get().records.values()) {
          if (
            r.kind === 'photo' &&
            r.personId === photo.personId &&
            r.isAvatar &&
            r.id !== photoId
          ) {
            puts.push({ ...r, isAvatar: false })
          }
        }
        await apply(puts)
      }),
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

/**
 * Per-person lookups (notes, photos, avatar, circles) come from one index
 * built lazily per records snapshot: every mutation swaps in a new Map,
 * so a WeakMap keyed on the Map itself invalidates for free. Without it,
 * a 300-row People list ran a full record scan per row per keystroke.
 * The arrays returned are shared — treat them as read-only.
 */
interface PersonIndex {
  notes: Map<string, NoteEntry[]>
  photos: Map<string, Photo[]>
  avatar: Map<string, Photo>
  circles: Map<string, Circle[]>
  circleList: Circle[]
}
const indexCache = new WeakMap<Map<string, DomainRecord>, PersonIndex>()
const EMPTY: never[] = []
function personIndex(records: Map<string, DomainRecord>): PersonIndex {
  const cached = indexCache.get(records)
  if (cached) return cached
  const idx: PersonIndex = {
    notes: new Map(),
    photos: new Map(),
    avatar: new Map(),
    circles: new Map(),
    circleList: [],
  }
  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  for (const r of records.values()) {
    if (r.kind === 'note') push(idx.notes, r.personId, r)
    else if (r.kind === 'photo') {
      push(idx.photos, r.personId, r)
      if (r.isAvatar && !idx.avatar.has(r.personId)) idx.avatar.set(r.personId, r)
    } else if (r.kind === 'circle') idx.circleList.push(r)
  }
  for (const list of idx.notes.values()) list.sort((a, b) => b.createdAt - a.createdAt)
  for (const list of idx.photos.values()) {
    list.sort((a, b) => Number(b.isAvatar) - Number(a.isAvatar) || a.createdAt - b.createdAt)
  }
  idx.circleList.sort((a, b) => a.name.localeCompare(b.name))
  for (const c of idx.circleList) for (const id of c.memberIds) push(idx.circles, id, c)
  indexCache.set(records, idx)
  return idx
}

export function selectNotes(records: Map<string, DomainRecord>, personId: string): NoteEntry[] {
  return personIndex(records).notes.get(personId) ?? EMPTY
}

export function selectPhotos(records: Map<string, DomainRecord>, personId: string): Photo[] {
  return personIndex(records).photos.get(personId) ?? EMPTY
}

export function selectAvatar(
  records: Map<string, DomainRecord>,
  personId: string,
): Photo | undefined {
  return personIndex(records).avatar.get(personId)
}

export function selectFollowUps(
  records: Map<string, DomainRecord>,
  personId: string,
): FollowUp[] {
  return [...records.values()]
    .filter((r): r is FollowUp => r.kind === 'followUp' && r.personId === personId)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt)
}

export function selectSettings(records: Map<string, DomainRecord>): Settings | undefined {
  const r = records.get(SETTINGS_ID)
  return r?.kind === 'settings' ? r : undefined
}

/** Search the in-memory index; returns person ids ranked by relevance. */
export function searchPeopleIds(query: string): string[] {
  return searchPeople(searchIndex, query)
}

export function selectCircles(records: Map<string, DomainRecord>): Circle[] {
  return personIndex(records).circleList
}

export function selectCirclesOf(
  records: Map<string, DomainRecord>,
  personId: string,
): Circle[] {
  return personIndex(records).circles.get(personId) ?? EMPTY
}
