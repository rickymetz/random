import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { daysUntilDue, daysUntilNext, formatPartialDate } from '../lib/dates'
import type { Person } from '../lib/models'
import { matchSnippet } from '../lib/search'
import {
  searchPeopleIds,
  selectPeople,
  selectSettings,
  useVaultStore,
} from '../store/vaultStore'

/**
 * Search-first home screen (scenario S2): as-you-type full-text search over
 * everything, an upcoming strip (the guaranteed reminder surface — §4.4),
 * and one-tap person creation from the query (scenario S1). Enter opens
 * the top result, or creates the person when there is none. The query
 * lives in the store so navigating into a dossier and back keeps it.
 */
export default function PeoplePage() {
  const records = useVaultStore((s) => s.records)
  const query = useVaultStore((s) => s.homeQuery)
  const setQuery = useVaultStore((s) => s.setHomeQuery)
  const addPerson = useVaultStore((s) => s.addPerson)
  const corrupted = useVaultStore((s) => s.corrupted)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const people = useMemo(() => {
    const all = selectPeople(records)
    const trimmed = query.trim()
    if (!trimmed) return all.sort((a, b) => a.displayName.localeCompare(b.displayName))
    const byId = new Map(all.map((p) => [p.id, p]))
    const ranked = searchPeopleIds(trimmed)
      .map((id) => byId.get(id))
      .filter((p): p is Person => Boolean(p))
    // Substring fallback catches what fuzzy/prefix scoring misses.
    const seen = new Set(ranked.map((p) => p.id))
    const q = trimmed.toLowerCase()
    for (const p of all) {
      if (!seen.has(p.id) && p.displayName.toLowerCase().includes(q)) ranked.push(p)
    }
    return ranked
  }, [records, query])

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const person = await addPerson(query.trim() || 'New person')
      setQuery('')
      navigate(`/person/${person.id}`)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (people.length > 0) navigate(`/person/${people[0].id}`)
    else if (query.trim()) void create()
  }

  const trimmed = query.trim()
  return (
    <div className="people">
      <form onSubmit={submit}>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people, facts, notes…"
          aria-label="Search people, facts, and notes"
        />
      </form>
      {corrupted > 0 && (
        <p className="banner" role="alert">
          {corrupted} record{corrupted === 1 ? '' : 's'} could not be read and were
          skipped. Restore from a backup if something is missing.
        </p>
      )}
      {!trimmed && <BackupNag />}
      {!trimmed && <Upcoming />}
      {trimmed && (
        <button className="add-person" onClick={create} disabled={busy}>
          + Add “{trimmed}”
        </button>
      )}
      <ul>
        {people.map((p) => (
          <PersonRow key={p.id} person={p} query={trimmed} />
        ))}
      </ul>
      {!trimmed && (
        <button className="add-person" onClick={create} disabled={busy}>
          + New person
        </button>
      )}
    </div>
  )
}

function PersonRow({ person, query }: { person: Person; query: string }) {
  const records = useVaultStore((s) => s.records)
  const detail = [person.jobTitle, person.employer].filter(Boolean).join(' @ ')
  // Show WHY a result matched when the hit came from note text (§4.4).
  const snippet = useMemo(() => {
    if (!query) return null
    const nameHit =
      person.displayName.toLowerCase().includes(query.toLowerCase()) ||
      detail.toLowerCase().includes(query.toLowerCase())
    return nameHit ? null : matchSnippet(records, person.id, query)
  }, [records, person, query, detail])

  return (
    <li>
      <Link to={`/person/${person.id}`} className="person-row">
        <Avatar person={person} size={36} />
        <span className="person-row-text">
          <strong>{person.displayName}</strong>
          {person.isSelf && (
            <span className="you-badge" aria-label="This is you">
              you
            </span>
          )}
          {detail && <span className="hint"> {detail}</span>}
          {snippet && <span className="snippet">{snippet}</span>}
        </span>
      </Link>
    </li>
  )
}

const HORIZON_DAYS = 30
const EXPORT_NAG_DAYS = 7

/** Re-render date math when the calendar day changes (midnight rollover). */
function useToday(): Date {
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const tick = setInterval(() => {
      setToday((prev) => {
        const now = new Date()
        return prev.toDateString() === now.toDateString() ? prev : now
      })
    }, 60_000)
    return () => clearInterval(tick)
  }, [])
  return today
}

function BackupNag() {
  const records = useVaultStore((s) => s.records)
  const settings = selectSettings(records)
  // The seeded "Me" person alone is not content worth nagging about.
  const hasContent = useMemo(
    () => selectPeople(records).some((p) => !p.isSelf),
    [records],
  )
  if (!hasContent) return null
  const last = settings?.lastExportAt
  const stale = !last || Date.now() - last > EXPORT_NAG_DAYS * 86_400_000
  if (!stale) return null
  return (
    <p className="banner">
      {last
        ? `Last backup ${Math.floor((Date.now() - last) / 86_400_000)} days ago.`
        : 'No backup yet.'}{' '}
      Browsers can evict storage — <Link to="/settings">export an encrypted backup</Link>.
    </p>
  )
}

interface UpcomingItem {
  key: string
  days: number
  overdue: boolean
  personId: string
  personName: string
  label: string
}

function Upcoming() {
  const records = useVaultStore((s) => s.records)
  const today = useToday()

  const items = useMemo(() => {
    const people = selectPeople(records)
    const byId = new Map(people.map((p) => [p.id, p]))
    const list: UpcomingItem[] = []
    for (const p of people) {
      if (!p.birthday) continue
      const days = daysUntilNext(p.birthday, today)
      if (days !== null && days <= HORIZON_DAYS) {
        list.push({
          key: `bday-${p.id}`,
          days,
          overdue: false,
          personId: p.id,
          personName: p.displayName,
          label: `birthday (${formatPartialDate(p.birthday)})`,
        })
      }
    }
    for (const r of records.values()) {
      if (r.kind !== 'followUp' || r.done || !r.dueDate) continue
      // Deadlines, not recurrences: overdue items stay visible (§4.4).
      const days = daysUntilDue(r.dueDate, today)
      if (days === null || days > HORIZON_DAYS) continue
      const person = byId.get(r.personId)
      if (!person) continue
      list.push({
        key: `fu-${r.id}`,
        days,
        overdue: days < 0,
        personId: r.personId,
        personName: person.displayName,
        label: r.text,
      })
    }
    return list.sort((a, b) => a.days - b.days).slice(0, 8)
  }, [records, today])

  if (items.length === 0) return null
  return (
    <section className="upcoming">
      <h2>Upcoming</h2>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <span className={`days ${item.overdue ? 'overdue' : ''}`}>
              {item.overdue
                ? `${-item.days}d late`
                : item.days === 0
                  ? 'today'
                  : `${item.days}d`}
            </span>
            <Link to={`/person/${item.personId}`}>{item.personName}</Link>
            <span className="hint"> — {item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
