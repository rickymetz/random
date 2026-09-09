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
import { extractMentions, stripMentionsOf } from '../lib/mentions'
import {
  BUILT_IN_RELATIONSHIP_TYPES,
  SETTINGS_ID,
  type DomainRecord,
  type FollowUp,
  type NoteEntry,
  type PartialDate,
  type Person,
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
import { createIndex, rebuildIndex, reindexPerson, searchPeople } from '../lib/search'
import { sanitizeRecords } from '../lib/validate'
import {
  createVault,
  deleteRecords,
  loadAllRecords,
  saveRecords,
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

interface VaultState {
  status: 'unknown' | 'no-vault' | 'locked' | 'unlocked'
  vault: UnlockedVault | null
  records: Map<string, DomainRecord>
  /** Bumped on every lock; async work from an older epoch discards itself. */
  epoch: number
  /** Rows that failed to decrypt at unlock — surfaced, not fatal. */
  corrupted: number
  /** Home-screen search query, preserved across navigation (memory only). */
  homeQuery: string

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
    patch: Partial<Pick<Settings, 'autoLockMinutes' | 'backgroundGraceSeconds'>>,
  ) => Promise<void>
  /** Capture-draft registry: auto-locks flush drafts into notes first. */
  registerDraft: (personId: string, read: () => string) => void
  unregisterDraft: (personId: string) => void
  flushDrafts: () => Promise<void>
  setHomeQuery: (query: string) => void

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
  addRelationshipType: (
    label: string,
    color: string,
    directed: boolean,
  ) => Promise<RelationshipType>
  markExported: () => Promise<void>
  importRecords: (incoming: unknown) => Promise<number>
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
    searchIndex = createIndex()
    rebuildIndex(searchIndex, records)
    set({
      status: 'unlocked',
      vault,
      records,
      corrupted,
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
    set((state) => ({
      status: state.status === 'no-vault' ? 'no-vault' : 'locked',
      vault: null,
      records: new Map(),
      epoch: state.epoch + 1,
      homeQuery: '',
      pinArmed: pinArmed(),
      pinAttemptsLeft: pinAttemptsLeft(),
      pinDigits: pinLength(),
    }))
  }

  return {
    status: 'unknown',
    vault: null,
    records: new Map(),
    epoch: 0,
    corrupted: 0,
    homeQuery: '',
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
      const seed = missingBuiltInTypes(records)
      await saveRecords(vault, seed)
      for (const t of seed) records.set(t.id, t)
      if (get().epoch !== startEpoch) return
      searchIndex = createIndex()
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

    updatePerson: (person) =>
      enqueue(async () => {
      await apply([{ ...person, updatedAt: Date.now() }], [], [person.id])
    }),

    removePerson: (personId) =>
      enqueue(async () => {
      const { records } = get()
      const deletes = [personId]
      const puts: DomainRecord[] = []
      const touched = new Set<string>([personId])
      for (const r of records.values()) {
        if (
          ((r.kind === 'note' || r.kind === 'followUp' || r.kind === 'photo') &&
            r.personId === personId) ||
          (r.kind === 'relationship' && (r.fromId === personId || r.toId === personId))
        ) {
          deletes.push(r.id)
        } else if (r.kind === 'note' && r.mentions.includes(personId)) {
          // Rewrite dangling mention tokens in other people's notes to the
          // plain name, so no dead @links survive the delete.
          puts.push({
            ...r,
            body: stripMentionsOf(r.body, personId),
            mentions: r.mentions.filter((m) => m !== personId),
          })
          touched.add(r.personId)
        }
      }
      await apply(puts, deletes, [...touched])
    }),

    saveNote: (personId, body) =>
      enqueue(async () => {
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

    importRecords: (incoming) =>
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
      const puts: DomainRecord[] = []
      for (const record of sanitized) {
        if (record.kind === 'relationshipType' && record.builtIn) {
          const existingId = builtInByLabel.get(record.label)
          if (existingId && existingId !== record.id) {
            idRemap.set(record.id, existingId)
            continue
          }
        }
        puts.push(
          record.kind === 'relationship'
            ? { ...record, typeId: idRemap.get(record.typeId) ?? record.typeId }
            : { ...record },
        )
      }
      await saveRecords(vault, puts)
      if (get().epoch !== startEpoch || get().vault !== vault) return puts.length
      // Merge onto the CURRENT records — writes that landed during the
      // import must not be lost from memory.
      const records = new Map(get().records)
      for (const record of puts) records.set(record.id, record)
      set({ records })
      rebuildIndex(searchIndex, records)
      return puts.length
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

export function selectSettings(records: Map<string, DomainRecord>): Settings | undefined {
  const r = records.get(SETTINGS_ID)
  return r?.kind === 'settings' ? r : undefined
}

/** Search the in-memory index; returns person ids ranked by relevance. */
export function searchPeopleIds(query: string): string[] {
  return searchPeople(searchIndex, query)
}
