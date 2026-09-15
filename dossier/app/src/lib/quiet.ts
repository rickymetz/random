/**
 * The "quiet" lens (§4.4): who have you lost touch with? A person is
 * quiet when nothing about them has been written in a while — no note,
 * no follow-up — counting from the day they were added if there never
 * was one. You yourself are never quiet.
 */
import type { DomainRecord, Person } from './models'
import { selectFollowUps, selectNotes, selectPeople } from '../store/vaultStore'

export const QUIET_MONTHS = 6
const MONTH_MS = 30.44 * 86400000
export const QUIET_MS = QUIET_MONTHS * MONTH_MS

/** When you last wrote anything about them (ms epoch). */
export function lastTouched(records: Map<string, DomainRecord>, person: Person): number {
  let last = person.createdAt
  for (const n of selectNotes(records, person.id)) if (n.createdAt > last) last = n.createdAt
  for (const f of selectFollowUps(records, person.id)) if (f.createdAt > last) last = f.createdAt
  return last
}

/** Months since the last touch when that is 6 or more; otherwise null. */
export function quietMonths(
  records: Map<string, DomainRecord>,
  person: Person,
  now: number = Date.now(),
): number | null {
  if (person.isSelf) return null
  const idle = now - lastTouched(records, person)
  if (idle < QUIET_MS) return null
  return Math.floor(idle / MONTH_MS)
}

/** "14 mo" / "2 yr" — the way the graph card says it. */
export function quietLabel(months: number): string {
  return months < 24 ? `${months} mo` : `${Math.floor(months / 12)} yr`
}

/** Everyone quiet, longest first. */
export function selectQuiet(
  records: Map<string, DomainRecord>,
  now: number = Date.now(),
): { person: Person; months: number }[] {
  const out: { person: Person; months: number }[] = []
  for (const p of selectPeople(records)) {
    const months = quietMonths(records, p, now)
    if (months !== null) out.push({ person: p, months })
  }
  return out.sort((a, b) => b.months - a.months || a.person.displayName.localeCompare(b.person.displayName))
}
