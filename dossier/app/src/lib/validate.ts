/**
 * Shape validation for records from untrusted sources (import bundles —
 * REQUIREMENTS.md §5 T2). A malformed or malicious backup must never be
 * able to persist records that later crash unlock or indexing: invalid
 * records are dropped, and every field the app dereferences is checked
 * or defaulted here.
 */
import type {
  Circle,
  CustomValue,
  DomainRecord,
  FieldDef,
  FieldType,
  FollowUp,
  NoteEntry,
  PartialDate,
  Person,
  Photo,
  Relationship,
  RelationshipType,
  Settings,
  TypeFamily,
} from './models'
import { RECENT_LIMIT } from './models'
import { extractMentions } from './mentions'

const ID_RE = /^[A-Za-z0-9-]{1,64}$/

const str = (v: unknown, max = 10_000): string | undefined =>
  typeof v === 'string' && v.length <= max ? v : undefined

const strList = (v: unknown, max = 100): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.length <= 200).slice(0, max)
    : []

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Date.now()

const bool = (v: unknown): boolean => v === true

const FIELD_TYPES = ['text', 'longText', 'chips', 'date', 'choice', 'number', 'boolean'] as const
const isFieldType = (v: unknown): v is FieldType =>
  typeof v === 'string' && (FIELD_TYPES as readonly string[]).includes(v)

/**
 * A custom answer, checked against nothing but its own shape: the field
 * it belongs to may be retired, or may not have arrived in this bundle
 * yet, and an answer whose field is missing is still the user's writing.
 * Anything that isn't one of the five shapes is dropped rather than
 * stored for a renderer to trip over later.
 */
function customValue(v: unknown): CustomValue | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.length <= 10_000 ? v : undefined
  if (Array.isArray(v)) {
    const list = strList(v)
    return list.length > 0 ? list : undefined
  }
  if (v && typeof v === 'object') return partialDate(v)
  return undefined
}

/** At most 200 answers per person, so a hostile bundle can't bloat a row. */
function customBag(v: unknown): Record<string, CustomValue> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, CustomValue> = {}
  let n = 0
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!ID_RE.test(key)) continue
    const value = customValue(raw)
    if (value === undefined) continue
    out[key] = value
    if (++n >= 200) break
  }
  return n > 0 ? out : undefined
}
const isFamily = (v: unknown): v is TypeFamily =>
  v === 'family' || v === 'work' || v === 'social' || v === 'other'

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
        custom: customBag(r.custom),
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
        // Re-derived from the text: a bundle can't claim a mention its body doesn't show.
        mentions: extractMentions(body),
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
        endDate: partialDate(r.endDate),
        former: bool(r.former) || undefined,
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
        family: isFamily(r.family) ? r.family : undefined,
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
    case 'circle': {
      const name = str(r.name, 100)?.trim()
      if (!name) return null
      const circle: Circle = {
        kind: 'circle',
        id: rid,
        name,
        color: /^#[0-9a-fA-F]{6}$/.test(String(r.color)) ? (r.color as string) : '#8aa4ff',
        memberIds: [...new Set(strList(r.memberIds, 1000).filter((m) => ID_RE.test(m)))],
        createdAt: num(r.createdAt),
        updatedAt: num(r.updatedAt),
      }
      return circle
    }
    case 'fieldDef': {
      const label = str(r.label, 60)?.trim()
      if (!label || !isFieldType(r.type)) return null
      const options = r.type === 'choice' ? [...new Set(strList(r.options, 50))] : undefined
      const def: FieldDef = {
        kind: 'fieldDef',
        id: rid,
        label,
        type: r.type,
        options: options && options.length > 0 ? options : undefined,
        order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0,
        retired: r.retired === true || undefined,
        // Only a date field can carry the reminder switches; anywhere
        // else they would be settings nothing reads.
        remindYearly: r.type === 'date' && r.remindYearly === true ? true : undefined,
        remindLeadDays:
          r.type === 'date' &&
          typeof r.remindLeadDays === 'number' &&
          Number.isInteger(r.remindLeadDays) &&
          r.remindLeadDays >= 0 &&
          r.remindLeadDays <= 90
            ? r.remindLeadDays
            : undefined,
        createdAt: num(r.createdAt),
        updatedAt: num(r.updatedAt),
      }
      return def
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
        shakeToLock: r.shakeToLock === true || undefined,
        nameSuggestions: r.nameSuggestions === false ? false : undefined,
        remindersEnabled: r.remindersEnabled === true || undefined,
        lastReminderDay:
          typeof r.lastReminderDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastReminderDay)
            ? r.lastReminderDay
            : undefined,
        recentIds: Array.isArray(r.recentIds)
          ? r.recentIds
              .filter((id): id is string => typeof id === 'string' && ID_RE.test(id))
              .slice(0, RECENT_LIMIT)
          : undefined,
      }
      if (settings.recentIds?.length === 0) settings.recentIds = undefined
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
