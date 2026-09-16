/**
 * The person form, as each vault defines it (REQUIREMENTS.md §8.1).
 *
 * The built-in fields keep their own typed slots on `Person` — birthday
 * reminders, contacts import, name detection and the quiet lens all read
 * them by name — so what lives here is only what the user invented.
 *
 * A field id is a uuid and never changes: renaming is a label change and
 * never touches an answer, and retiring a field leaves every answer in
 * place under that same key, waiting to be restored.
 */
import type { CustomValue, DomainRecord, FieldDef, FieldType, PartialDate, Person } from './models'

/** Enough rows to describe a person; past this the form stops being one. */
export const MAX_FIELDS = 40

export interface FieldSeed {
  label: string
  type: FieldType
  options?: string[]
  remindYearly?: boolean
  remindLeadDays?: number
}

export interface FieldPack {
  id: string
  name: string
  blurb: string
  fields: FieldSeed[]
}

/**
 * Starter packs: a first form to edit rather than a blank page. Picking
 * none is allowed — the essentials pack is what a skipped setup leaves.
 */
export const FIELD_PACKS: FieldPack[] = [
  {
    id: 'essentials',
    name: 'Just the essentials',
    blurb: 'Almost nothing. Add your own as you go.',
    fields: [
      { label: 'How we met', type: 'longText' },
      { label: 'Interests', type: 'chips' },
    ],
  },
  {
    id: 'family',
    name: 'Family & friends',
    blurb: 'Birthdays, kids, allergies, gift ideas.',
    fields: [
      { label: 'Kids', type: 'chips' },
      { label: 'Allergies & dietary', type: 'chips' },
      { label: 'Gift ideas', type: 'chips' },
      { label: 'Favourite places', type: 'chips' },
      { label: 'Anniversary', type: 'date', remindYearly: true, remindLeadDays: 7 },
      { label: 'How we met', type: 'longText' },
    ],
  },
  {
    id: 'work',
    name: 'Work & professional',
    blurb: 'Where you met, what they do, what you owe them.',
    fields: [
      { label: 'Where we met', type: 'choice', options: ['work', 'conference', 'online', 'introduced', 'school'] },
      { label: 'Who introduced us', type: 'text' },
      { label: 'Working on', type: 'longText' },
      { label: 'Follow-up owed', type: 'boolean' },
      { label: 'Started here', type: 'date', remindYearly: true, remindLeadDays: 0 },
    ],
  },
]

/** A field's answer, ready to render: active fields in form order. */
export function activeFields(defs: FieldDef[]): FieldDef[] {
  return defs
    .filter((d) => !d.retired)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

export function retiredFields(defs: FieldDef[]): FieldDef[] {
  return defs.filter((d) => d.retired).sort((a, b) => a.label.localeCompare(b.label))
}

/** An answer counts as given when it would draw something on a dossier. */
export function hasValue(value: CustomValue | undefined): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return true
  // A "no" is an answer: someone said it, and the row should show it.
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  const d = value as PartialDate
  return d.year !== undefined || d.month !== undefined
}

/**
 * The words a value contributes to the search index. Dates are left out:
 * "1990" matching a birth year is noise, and the dossier shows them
 * formatted anyway.
 */
export function searchableValue(def: FieldDef, value: CustomValue | undefined): string {
  if (!hasValue(value)) return ''
  if (def.type === 'boolean') return value === true ? def.label : ''
  if (Array.isArray(value)) return value.join(' ')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

/** A new field lands at the end of the form. */
export function nextOrder(defs: FieldDef[]): number {
  return defs.reduce((max, d) => Math.max(max, d.order), -1) + 1
}

/** Two fields may not share a label; the editor refuses in place. */
export function labelTaken(defs: FieldDef[], label: string, exceptId?: string): boolean {
  const key = label.trim().toLowerCase()
  return defs.some((d) => d.id !== exceptId && d.label.trim().toLowerCase() === key)
}

/** The empty answer for a type, for a form that has just added a row. */
export function blankValue(type: FieldType): CustomValue {
  switch (type) {
    case 'chips':
      return []
    case 'boolean':
      return false
    case 'number':
      return 0
    case 'date':
      return {}
    default:
      return ''
  }
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  longText: 'Long text',
  chips: 'List of tags',
  date: 'Date',
  choice: 'Pick one',
  number: 'Number',
  boolean: 'Yes or no',
}

/** A date a person carries that comes round every year. */
export interface YearlyDate {
  fieldId: string
  label: string
  date: PartialDate
  /** Days of warning the field asks for; 0 is on the day. */
  leadDays: number
}

/**
 * The custom date fields marked "remind me every year", with the answers
 * this person gave (§8.1). Birthdays are not here — they have their own
 * slot and their own line everywhere — so a caller wanting both adds the
 * birthday itself.
 */
export function yearlyDatesOf(person: Person, defs: FieldDef[]): YearlyDate[] {
  if (!person.custom) return []
  const out: YearlyDate[] = []
  for (const def of defs) {
    if (def.type !== 'date' || !def.remindYearly || def.retired) continue
    const value = person.custom[def.id]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const date = value as PartialDate
    if (date.month === undefined) continue
    out.push({
      fieldId: def.id,
      label: def.label,
      date,
      leadDays: def.remindLeadDays ?? 0,
    })
  }
  return out
}

/** The field definitions in a records map, for callers outside the store. */
export function fieldDefsIn(records: Map<string, DomainRecord>): FieldDef[] {
  return [...records.values()].filter((r): r is FieldDef => r.kind === 'fieldDef')
}
