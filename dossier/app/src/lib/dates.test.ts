import { describe, expect, it } from 'vitest'
import { daysUntilDue, daysUntilNext, formatPartialDate, parsePartialDate } from './dates'

describe('partial dates', () => {
  it('round-trips every format formatPartialDate produces', () => {
    const cases = [
      { year: 1984, month: 6, day: 21 },
      { month: 6, day: 21 },
      { month: 6, year: 1984 },
      { month: 6 },
      { year: 1984 },
    ]
    for (const d of cases) {
      // Editing a person must not mangle their birthday (the form seeds
      // the input with the formatted value and parses it back).
      expect(parsePartialDate(formatPartialDate(d))).toEqual(d)
    }
  })

  it('parses common loose input', () => {
    expect(parsePartialDate('1984-06-21')).toEqual({ year: 1984, month: 6, day: 21 })
    expect(parsePartialDate('06-21')).toEqual({ month: 6, day: 21 })
    expect(parsePartialDate('June')).toEqual({ month: 6 })
    expect(parsePartialDate('21 June 1984')).toEqual({ year: 1984, month: 6, day: 21 })
    expect(parsePartialDate('Jun 21, 1984')).toEqual({ year: 1984, month: 6, day: 21 })
    expect(parsePartialDate('June 21')).toEqual({ month: 6, day: 21 })
  })

  it('rejects out-of-range values instead of storing garbage', () => {
    expect(parsePartialDate('1984-13-45')).toBeUndefined()
    expect(parsePartialDate('06-31')).toBeUndefined()
    expect(parsePartialDate('Feb 30')).toBeUndefined()
    expect(parsePartialDate('gibberish')).toBeUndefined()
    // Feb 29 stays valid — leap years exist and partial dates may lack a year.
    expect(parsePartialDate('Feb 29')).toEqual({ month: 2, day: 29 })
  })

  it('recurs birthdays across the year boundary', () => {
    const from = new Date(2026, 11, 30) // Dec 30, 2026
    expect(daysUntilNext({ month: 1, day: 2 }, from)).toBe(3)
    expect(daysUntilNext({ month: 12, day: 30 }, from)).toBe(0)
    expect(daysUntilNext({ year: 1984 }, from)).toBeNull()
  })

  it('treats follow-up due dates as deadlines that go overdue', () => {
    const from = new Date(2026, 8, 9) // Sep 9, 2026
    // One day late is -1, not 364-days-away (§4.4: overdue must surface).
    expect(daysUntilDue({ year: 2026, month: 9, day: 8 }, from)).toBe(-1)
    expect(daysUntilDue({ year: 2026, month: 9, day: 19 }, from)).toBe(10)
    expect(daysUntilDue({ year: 2025, month: 12, day: 1 }, from)).toBeLessThan(-250)
    // Yearless due dates fall back to next-occurrence semantics.
    expect(daysUntilDue({ month: 9, day: 19 }, from)).toBe(10)
  })
})
