/**
 * Shape validation for records from untrusted sources (import bundles —
 * REQUIREMENTS.md §5 T2). A malformed or malicious backup must never be
 * able to persist records that later crash unlock or indexing: invalid
 * records are dropped, and every field the app dereferences is checked
 * or defaulted here.
 */
import type {
  DomainRecord,
  FollowUp,
  NoteEntry,
  PartialDate,
  Person,
  Photo,
  Relationship,
  RelationshipType,
  Settings,
} from './models'

const ID_RE = /^[A-Za-z0-9-]{1,64}$/

const str = (v: unknown, max = 10_000): string | undefined =>
  typeof v === 'string' && v.length <= max ? v : undefined

const strList = (v: unknown, max = 100): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, max) : []

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Date.now()

const bool = (v: unknown): boolean => v === true

function id(v: unknown): string | null {
  return typeof v === 'string' && ID_RE.test(v) ? v : null
}

function partialDate(v: unknown): PartialDate | undefined {
  if (!v || typeof v !== 'object') return undefined
  const d = v as Record<string, unknown>
  const out: PartialDate = {}
  if (typeof d.year === 'number' && Number.isInteger(d.year)) out.year = d.year
  if (typeof d.month === 'number' && d.month >= 1 && d.month <= 12) out.month = d.month
  if (typeof d.day === 'number' && d.day >= 1 && d.day <= 31) out.day = d.day
  return out.year || out.month ? out : undefined
}

function sanitizeOne(raw: unknown): DomainRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rid = id(r.id)
  if (!rid) return null

  switch (r.kind) {
    case 'person': {
      const person: Person = {
        kind: 'person',
        id: rid,
        displayName: str(r.displayName, 200) || 'Unnamed',
        nicknames: strList(r.nicknames),
        pronouns: str(r.pronouns, 100),
        jobTitle: str(r.jobTitle, 200),
        employer: str(r.employer, 200),
        location: str(r.location, 200),
        birthday: partialDate(r.birthday),
        howWeMet: str(r.howWeMet, 2000),
        contact:
          r.contact && typeof r.contact === 'object'
            ? {
                phone: str((r.contact as Record<string, unknown>).phone, 100),
                email: str((r.contact as Record<string, unknown>).email, 200),
                other: str((r.contact as Record<string, unknown>).other, 500),
              }
            : undefined,
        likes: strList(r.likes),
        dislikes: strList(r.dislikes),
        tags: strList(r.tags),
        isSelf: bool(r.isSelf) || undefined,
        createdAt: num(r.createdAt),
        updatedAt: num(r.updatedAt),
      }
      return person
    }
    case 'note': {
      const personId = id(r.personId)
      const body = str(r.body, 50_000)
      if (!personId || body === undefined) return null
      const note: NoteEntry = {
        kind: 'note',
        id: rid,
        personId,
        body,
        mentions: strList(r.mentions).filter((m) => ID_RE.test(m)),
        createdAt: num(r.createdAt),
      }
      return note
    }
    case 'followUp': {
      const personId = id(r.personId)
      const text = str(r.text, 2000)
      if (!personId || text === undefined) return null
      const followUp: FollowUp = {
        kind: 'followUp',
        id: rid,
        personId,
        text,
        dueDate: partialDate(r.dueDate),
        done: bool(r.done),
        createdAt: num(r.createdAt),
      }
      return followUp
    }
    case 'relationship': {
      const fromId = id(r.fromId)
      const toId = id(r.toId)
      const typeId = id(r.typeId)
      if (!fromId || !toId || !typeId) return null
      const rel: Relationship = {
        kind: 'relationship',
        id: rid,
        fromId,
        toId,
        typeId,
        directed: bool(r.directed),
        note: str(r.note, 2000),
        startDate: partialDate(r.startDate),
        origin: r.origin === 'mention' ? 'mention' : 'explicit',
        createdAt: num(r.createdAt),
      }
      return rel
    }
    case 'relationshipType': {
      const label = str(r.label, 100)
      if (!label) return null
      const type: RelationshipType = {
        kind: 'relationshipType',
        id: rid,
        label,
        color: /^#[0-9a-fA-F]{6}$/.test(String(r.color)) ? (r.color as string) : '#55555e',
        directed: bool(r.directed),
        builtIn: bool(r.builtIn),
      }
      return type
    }
    case 'photo': {
      const personId = id(r.personId)
      const blobRecordId = id(r.blobRecordId)
      if (!personId || !blobRecordId) return null
      // Strict image allowlist: the mimeType becomes the Blob type of a
      // rendered object URL, so text/html or svg here would hand an
      // imported bundle a script-capable document.
      const SAFE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
      const mime = str(r.mimeType, 100)
      const photo: Photo = {
        kind: 'photo',
        id: rid,
        personId,
        isAvatar: bool(r.isAvatar),
        mimeType: mime && SAFE_IMAGE_TYPES.includes(mime) ? mime : 'image/jpeg',
        blobRecordId,
        createdAt: num(r.createdAt),
      }
      return photo
    }
    case 'settings': {
      const finite = (v: unknown, min: number, max: number): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined
      const settings: Settings = {
        kind: 'settings',
        id: rid,
        lastExportAt: finite(r.lastExportAt, 0, Number.MAX_SAFE_INTEGER),
        autoLockMinutes: finite(r.autoLockMinutes, 0, 24 * 60),
        backgroundGraceSeconds: finite(r.backgroundGraceSeconds, 0, 3600),
      }
      return settings
    }
    default:
      return null
  }
}

export interface SanitizeResult {
  records: DomainRecord[]
  dropped: number
}

export function sanitizeRecords(raw: unknown): SanitizeResult {
  if (!Array.isArray(raw)) return { records: [], dropped: 0 }
  const records: DomainRecord[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const item of raw) {
    const record = sanitizeOne(item)
    if (record && !seen.has(record.id)) {
      seen.add(record.id)
      records.push(record)
    } else {
      dropped += 1
    }
  }
  return { records, dropped }
}
