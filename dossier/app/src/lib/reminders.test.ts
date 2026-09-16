import { describe, expect, it } from 'vitest'
import type { DomainRecord, FieldDef, FollowUp, Person } from './models'
import { hasDueItems, todayStamp } from './reminders'

function person(id: string, birthday?: Person['birthday']): Person {
  return {
    kind: 'person',
    id,
    displayName: id,
    nicknames: [],
    likes: [],
    dislikes: [],
    tags: [],
    birthday,
    createdAt: 0,
    updatedAt: 0,
  }
}

function followUp(personId: string, dueDate: FollowUp['dueDate'], done = false): FollowUp {
  return {
    kind: 'followUp',
    id: `f-${personId}-${Math.random()}`,
    personId,
    text: 'ask',
    dueDate,
    done,
    createdAt: 0,
  }
}

const recordsOf = (...items: DomainRecord[]) => new Map(items.map((r) => [r.id, r]))

describe('reminders', () => {
  const now = new Date(2026, 8, 9) // Sep 9

  it('fires for a birthday today and an overdue follow-up, not otherwise', () => {
    expect(hasDueItems(recordsOf(person('a', { month: 9, day: 9 })), now)).toBe(true)
    expect(hasDueItems(recordsOf(person('a', { month: 9, day: 10 })), now)).toBe(false)
    expect(
      hasDueItems(
        recordsOf(person('a'), followUp('a', { year: 2026, month: 9, day: 5 })),
        now,
      ),
    ).toBe(true)
    expect(
      hasDueItems(
        recordsOf(person('a'), followUp('a', { year: 2026, month: 9, day: 5 }, true)),
        now,
      ),
    ).toBe(false)
    // Long-overdue items age out of the notification (7-day window) —
    // a forgotten follow-up must not ring every day forever.
    expect(
      hasDueItems(
        recordsOf(person('a'), followUp('a', { year: 2026, month: 9, day: 1 })),
        now,
      ),
    ).toBe(false)
    expect(
      hasDueItems(
        recordsOf(person('a'), followUp('a', { year: 2026, month: 12, day: 1 })),
        now,
      ),
    ).toBe(false)
  })

  it('ignores follow-ups whose person was deleted', () => {
    expect(
      hasDueItems(recordsOf(followUp('ghost', { year: 2026, month: 9, day: 5 })), now),
    ).toBe(false)
  })

  it('stamps days stably', () => {
    expect(todayStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('a date row marked "remind me every year"', () => {
  const now = new Date('2026-06-14T09:00:00Z')
  const anniversary = (leadDays: number): DomainRecord[] => [
    {
      kind: 'fieldDef',
      id: 'f-1',
      label: 'Anniversary',
      type: 'date',
      order: 0,
      remindYearly: true,
      remindLeadDays: leadDays,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      kind: 'person',
      id: 'p-1',
      displayName: 'Priya',
      nicknames: [],
      likes: [],
      dislikes: [],
      tags: [],
      // A week out from "today".
      custom: { 'f-1': { year: 2014, month: 6, day: 21 } },
      createdAt: 0,
      updatedAt: 0,
    },
  ]
  const asMap = (rs: DomainRecord[]) => new Map(rs.map((r) => [r.id, r]))

  it('is due inside the lead time it asked for', () => {
    expect(hasDueItems(asMap(anniversary(7)), now)).toBe(true)
  })

  it('is not due outside it — a week away is not "on the day"', () => {
    expect(hasDueItems(asMap(anniversary(0)), now)).toBe(false)
    expect(hasDueItems(asMap(anniversary(3)), now)).toBe(false)
  })

  it('goes quiet when the row retires, answer and all', () => {
    const records = anniversary(7)
    records[0] = { ...(records[0] as FieldDef), retired: true }
    expect(hasDueItems(asMap(records), now)).toBe(false)
  })

  it('stays quiet for a date row nobody asked to be reminded about', () => {
    const records = anniversary(7)
    records[0] = { ...(records[0] as FieldDef), remindYearly: undefined }
    expect(hasDueItems(asMap(records), now)).toBe(false)
  })
})
