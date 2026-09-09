import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { daysUntilNext, formatPartialDate } from '../lib/dates'
import type { FollowUp, Person } from '../lib/models'
import { searchPeopleIds, selectPeople, useVaultStore } from '../store/vaultStore'

/**
 * Search-first home screen (scenario S2): as-you-type full-text search over
 * everything, an upcoming strip (the guaranteed reminder surface — §4.4),
 * and one-tap person creation from the query (scenario S1).
 */
export default function PeoplePage() {
  const records = useVaultStore((s) => s.records)
  const addPerson = useVaultStore((s) => s.addPerson)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

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
    const person = await addPerson(query.trim() || 'New person')
    navigate(`/person/${person.id}`)
  }

  return (
    <div className="people">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people, facts, notes…"
      />
      {!query && <Upcoming />}
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <Link to={`/person/${p.id}`}>
              <strong>{p.displayName}</strong>
              {(p.jobTitle || p.employer) && (
                <span className="hint">
                  {' '}
                  {[p.jobTitle, p.employer].filter(Boolean).join(' @ ')}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <button onClick={create}>
        + {query.trim() ? `Add “${query.trim()}”` : 'New person'}
      </button>
    </div>
  )
}

const HORIZON_DAYS = 30

interface UpcomingItem {
  key: string
  days: number
  personId: string
  personName: string
  label: string
}

function Upcoming() {
  const records = useVaultStore((s) => s.records)

  const items = useMemo(() => {
    const people = selectPeople(records)
    const byId = new Map(people.map((p) => [p.id, p]))
    const list: UpcomingItem[] = []
    for (const p of people) {
      if (!p.birthday) continue
      const days = daysUntilNext(p.birthday)
      if (days !== null && days <= HORIZON_DAYS) {
        list.push({
          key: `bday-${p.id}`,
          days,
          personId: p.id,
          personName: p.displayName,
          label: `birthday (${formatPartialDate(p.birthday)})`,
        })
      }
    }
    for (const r of records.values()) {
      if (r.kind !== 'followUp' || r.done || !r.dueDate) continue
      const f = r as FollowUp
      const days = daysUntilNext(f.dueDate!)
      if (days !== null && days <= HORIZON_DAYS) {
        const person = byId.get(f.personId)
        if (!person) continue
        list.push({
          key: `fu-${f.id}`,
          days,
          personId: f.personId,
          personName: person.displayName,
          label: f.text,
        })
      }
    }
    return list.sort((a, b) => a.days - b.days).slice(0, 8)
  }, [records])

  if (items.length === 0) return null
  return (
    <section className="upcoming">
      <h2>Upcoming</h2>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <span className="days">{item.days === 0 ? 'today' : `${item.days}d`}</span>
            <Link to={`/person/${item.personId}`}>{item.personName}</Link>
            <span className="hint"> — {item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
