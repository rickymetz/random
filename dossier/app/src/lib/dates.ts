import type { PartialDate } from './models'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// February allows 29: leap years exist and a partial date may have no
// year to check against.
function daysInMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/** "sometime in June" must be representable (§4.1) — render what's known. */
export function formatPartialDate(d: PartialDate): string {
  const month = d.month ? MONTHS[d.month - 1] : undefined
  if (month && d.day && d.year) return `${month} ${d.day}, ${d.year}`
  if (month && d.day) return `${month} ${d.day}`
  if (month && d.year) return `${month} ${d.year}`
  if (month) return month
  if (d.year) return String(d.year)
  return ''
}

function validated(d: PartialDate): PartialDate | undefined {
  if (d.month !== undefined && (d.month < 1 || d.month > 12)) return undefined
  if (d.day !== undefined) {
    if (d.month === undefined) return undefined
    if (d.day < 1 || d.day > daysInMonth(d.month)) return undefined
  }
  if (d.year !== undefined && (d.year < 1000 || d.year > 3000)) return undefined
  return d.year !== undefined || d.month !== undefined ? d : undefined
}

function monthFromName(text: string): number | undefined {
  const idx = MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()))
  return idx >= 0 ? idx + 1 : undefined
}

/**
 * Parse loose input. Accepts ISO ("1984-06-21", "1984-06", "1984"),
 * "06-21", every format formatPartialDate produces ("Jun 21, 1984",
 * "Jun 21", "Jun 1984", "Jun"), and day-first ("21 June 1984", "21 Jun").
 * Returns undefined for anything unrecognized or out of range — callers
 * must treat undefined-from-nonempty-input as a validation error to show,
 * never as "store nothing" (a silently dropped birthday is data loss).
 */
export function parsePartialDate(input: string): PartialDate | undefined {
  const text = input.trim().replace(/,/g, '')
  if (!text) return undefined

  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text)
  if (iso) {
    const d: PartialDate = { year: Number(iso[1]) }
    if (iso[2]) d.month = Number(iso[2])
    if (iso[3]) d.day = Number(iso[3])
    return validated(d)
  }

  const monthDay = /^(\d{1,2})-(\d{1,2})$/.exec(text)
  if (monthDay) return validated({ month: Number(monthDay[1]), day: Number(monthDay[2]) })

  // "Jun 21 1984" | "Jun 21" | "Jun 1984" | "June"
  const nameFirst = /^([A-Za-z]+)(?:\s+(\d{1,2}))?(?:\s+(\d{4}))?$/.exec(text)
  if (nameFirst) {
    const month = monthFromName(nameFirst[1])
    if (month === undefined) return undefined
    const d: PartialDate = { month }
    if (nameFirst[2]) {
      // "Jun 1984" — a 4-digit second token is a year, not a day.
      if (nameFirst[2].length === 4 && !nameFirst[3]) d.year = Number(nameFirst[2])
      else d.day = Number(nameFirst[2])
    }
    if (nameFirst[3]) d.year = Number(nameFirst[3])
    return validated(d)
  }
  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(text)
  if (monthYear) {
    const month = monthFromName(monthYear[1])
    return month === undefined ? undefined : validated({ month, year: Number(monthYear[2]) })
  }

  // "21 June 1984" | "21 Jun"
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/.exec(text)
  if (dayFirst) {
    const month = monthFromName(dayFirst[2])
    if (month === undefined) return undefined
    const d: PartialDate = { month, day: Number(dayFirst[1]) }
    if (dayFirst[3]) d.year = Number(dayFirst[3])
    return validated(d)
  }

  return undefined
}

const DAY_MS = 86_400_000

/**
 * Days until the next RECURRENCE of a (possibly partial) date — for
 * birthdays and anniversaries. Ignores the year; null when it has no
 * month. Day defaults to the 1st.
 */
export function daysUntilNext(d: PartialDate, from: Date = new Date()): number | null {
  if (!d.month) return null
  const day = d.day ?? 1
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let next = new Date(from.getFullYear(), d.month - 1, day)
  if (next < today) next = new Date(from.getFullYear() + 1, d.month - 1, day)
  return Math.round((next.getTime() - today.getTime()) / DAY_MS)
}

/**
 * Days until a one-off DEADLINE — for follow-up due dates. Respects the
 * year and goes NEGATIVE when overdue, so a missed follow-up surfaces as
 * late instead of silently rolling a year forward (§4.4: the upcoming
 * view is the reliable fallback). A yearless date is treated as the next
 * occurrence.
 */
export function daysUntilDue(d: PartialDate, from: Date = new Date()): number | null {
  if (!d.month && !d.year) return null
  if (d.year === undefined) return daysUntilNext(d, from)
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const due = new Date(d.year, (d.month ?? 1) - 1, d.day ?? 1)
  return Math.round((due.getTime() - today.getTime()) / DAY_MS)
}

/** Compact relative timestamp for the interaction log ("3d ago"). */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
