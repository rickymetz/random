import type { PartialDate } from './models'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

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

/** Parse loose input: "1984-06-21", "06-21", "June", "1984". */
export function parsePartialDate(input: string): PartialDate | undefined {
  const text = input.trim()
  if (!text) return undefined
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text)
  if (iso) {
    const d: PartialDate = { year: Number(iso[1]) }
    if (iso[2]) d.month = Number(iso[2])
    if (iso[3]) d.day = Number(iso[3])
    return d
  }
  const monthDay = /^(\d{1,2})-(\d{1,2})$/.exec(text)
  if (monthDay) return { month: Number(monthDay[1]), day: Number(monthDay[2]) }
  const monthIdx = MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()))
  if (monthIdx >= 0) return { month: monthIdx + 1 }
  return undefined
}

/**
 * Days until the next occurrence of a (possibly partial) date, or null
 * when it has no month (a bare year can't recur). Day defaults to the 1st.
 */
export function daysUntilNext(d: PartialDate, from: Date = new Date()): number | null {
  if (!d.month) return null
  const day = d.day ?? 1
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let next = new Date(from.getFullYear(), d.month - 1, day)
  if (next < today) next = new Date(from.getFullYear() + 1, d.month - 1, day)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}
