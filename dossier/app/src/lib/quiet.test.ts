import { describe, expect, it } from 'vitest'
import type { DomainRecord, FollowUp, NoteEntry, Person } from './models'
import { QUIET_MS, quietLabel, quietMonths, selectQuiet } from './quiet'

const DAY = 86400000
let uid = 0
const person = (name: string, createdAt: number, isSelf = false): Person => ({
  kind: 'person',
  id: `p${++uid}`,
  displayName: name,
  nicknames: [],
  likes: [],
  dislikes: [],
  tags: [],
  isSelf: isSelf || undefined,
  createdAt,
  updatedAt: createdAt,
})
const note = (p: Person, createdAt: number): NoteEntry => ({
  kind: 'note',
  id: `n${++uid}`,
  personId: p.id,
  body: 'hi',
  mentions: [],
  createdAt,
})
const followUp = (p: Person, createdAt: number): FollowUp => ({
  kind: 'followUp',
  id: `f${++uid}`,
  personId: p.id,
  text: 'call',
  done: false,
  createdAt,
})
const recordsOf = (...items: DomainRecord[]) => new Map(items.map((r) => [r.id, r]))

describe('quiet lens', () => {
  const now = 1_800_000_000_000
  it('counts from the last note or follow-up, or from when they were added', () => {
    const fresh = person('Fresh', now - 400 * DAY)
    const old = person('Old', now - 400 * DAY)
    const noted = person('Noted', now - 400 * DAY)
    const me = person('Me', now - 900 * DAY, true)
    const records = recordsOf(
      fresh,
      old,
      noted,
      me,
      note(fresh, now - 10 * DAY),
      note(noted, now - 300 * DAY),
      followUp(noted, now - 200 * DAY),
    )
    expect(quietMonths(records, fresh, now)).toBeNull()
    expect(quietMonths(records, old, now)).toBe(13)
    expect(quietMonths(records, noted, now)).toBe(6)
    expect(quietMonths(records, me, now)).toBeNull()
    expect(selectQuiet(records, now).map((q) => q.person.displayName)).toEqual(['Old', 'Noted'])
  })

  it('starts at six months and says it briefly', () => {
    const p = person('P', now - QUIET_MS + DAY)
    expect(quietMonths(recordsOf(p), p, now)).toBeNull()
    const q = person('Q', now - QUIET_MS - DAY)
    expect(quietMonths(recordsOf(q), q, now)).toBe(6)
    expect(quietLabel(14)).toBe('14 mo')
    expect(quietLabel(30)).toBe('2 yr')
  })
})
