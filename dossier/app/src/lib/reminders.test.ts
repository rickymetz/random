import { describe, expect, it } from 'vitest'
import type { DomainRecord, FollowUp, Person } from './models'
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
