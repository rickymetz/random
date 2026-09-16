import { describe, expect, it } from 'vitest'
import { sanitizeRecords } from './validate'
import type { FieldDef, Person } from './models'

const now = Date.now()
const person = (custom?: Record<string, unknown>): Record<string, unknown> => ({
  kind: 'person',
  id: crypto.randomUUID(),
  displayName: 'Priya Raman',
  nicknames: [],
  likes: [],
  dislikes: [],
  tags: [],
  custom,
  createdAt: now,
  updatedAt: now,
})
const def = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'fieldDef',
  id: crypto.randomUUID(),
  label: 'Allergies',
  type: 'chips',
  order: 0,
  createdAt: now,
  updatedAt: now,
  ...over,
})
const one = <T>(raw: Record<string, unknown>): T => {
  const { records } = sanitizeRecords([raw])
  expect(records).toHaveLength(1)
  return records[0] as T
}

describe('custom answers survive the sanitizer', () => {
  // The sanitizer runs on every unlock and every import, and it has
  // dropped a field before (a role's `former` came back current after a
  // relock). Every shape a custom field can hold is checked here.
  it('round-trips all five value shapes', () => {
    const custom = {
      't-1': 'a string',
      't-2': 42,
      't-3': true,
      't-4': ['rope', 'chalk'],
      't-5': { year: 1990, month: 3, day: 14 },
    }
    expect(one<Person>(person(custom)).custom).toEqual(custom)
  })

  it('keeps false and zero, which are answers like any other', () => {
    const custom = { 't-1': false, 't-2': 0 }
    expect(one<Person>(person(custom)).custom).toEqual(custom)
  })

  it('keeps an answer whose field is not here', () => {
    // A retired field, or a bundle whose definitions arrive separately.
    expect(one<Person>(person({ 'gone-1': 'still mine' })).custom).toEqual({ 'gone-1': 'still mine' })
  })

  it('drops junk without taking the rest of the person with it', () => {
    const p = one<Person>(person({ ok: 'kept', bad: { nope: 1 }, worse: () => 1 }))
    expect(p.custom).toEqual({ ok: 'kept' })
    expect(p.displayName).toBe('Priya Raman')
  })

  it('refuses a hostile key and an oversized bag', () => {
    const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`f-${i}`, 'x']))
    expect(Object.keys(one<Person>(person(many)).custom ?? {})).toHaveLength(200)
    expect(one<Person>(person({ 'not a key!': 'x' })).custom).toBeUndefined()
  })

  it('leaves a person with no custom answers alone', () => {
    expect(one<Person>(person()).custom).toBeUndefined()
  })
})

describe('field definitions survive the sanitizer', () => {
  it('round-trips a definition', () => {
    const d = one<FieldDef>(def({ label: 'Fears', type: 'longText', order: 3 }))
    expect(d).toMatchObject({ kind: 'fieldDef', label: 'Fears', type: 'longText', order: 3 })
  })

  it('keeps a choice field’s options, deduped', () => {
    const d = one<FieldDef>(def({ type: 'choice', options: ['work', 'school', 'work'] }))
    expect(d.options).toEqual(['work', 'school'])
  })

  it('keeps the retired flag', () => {
    expect(one<FieldDef>(def({ retired: true })).retired).toBe(true)
    expect(one<FieldDef>(def()).retired).toBeUndefined()
  })

  it('carries the yearly reminder and its lead time, on date fields only', () => {
    const d = one<FieldDef>(def({ type: 'date', remindYearly: true, remindLeadDays: 7 }))
    expect(d.remindYearly).toBe(true)
    expect(d.remindLeadDays).toBe(7)
    const chips = one<FieldDef>(def({ type: 'chips', remindYearly: true, remindLeadDays: 7 }))
    expect(chips.remindYearly).toBeUndefined()
    expect(chips.remindLeadDays).toBeUndefined()
  })

  it('refuses a definition with no label or an unknown type', () => {
    expect(sanitizeRecords([def({ label: '  ' })]).records).toHaveLength(0)
    expect(sanitizeRecords([def({ type: 'signature' })]).records).toHaveLength(0)
  })

  it('clamps a silly lead time rather than storing it', () => {
    expect(one<FieldDef>(def({ type: 'date', remindYearly: true, remindLeadDays: 900 })).remindLeadDays)
      .toBeUndefined()
  })
})
