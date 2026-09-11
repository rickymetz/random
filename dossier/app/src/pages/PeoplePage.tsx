import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { daysUntilDue, daysUntilNext, formatPartialDate } from '../lib/dates'
import type { Person } from '../lib/models'
import { matchSnippet } from '../lib/search'
import {
  searchPeopleIds,
  selectCirclesOf,
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
  const searchRef = useRef<HTMLInputElement>(null)

  // Facet links (a tag or like on a dossier) arrive as ?q=…: adopt the
  // query, then drop the param so back/forward stays clean.
  const [params, setParams] = useSearchParams()
  const linkedQuery = params.get('q')
  // ?circle=<id> lists one circle's members (from a chip on a dossier or
  // the graph's bubble card).
  const circleId = params.get('circle')
  const circle = useMemo(() => {
    const c = circleId ? records.get(circleId) : undefined
    return c?.kind === 'circle' ? c : undefined
  }, [records, circleId])
  // A circle link means "show me this circle" — not this circle narrowed
  // by whatever was last typed in the search box.
  useEffect(() => {
    if (circleId) setQuery('')
  }, [circleId, setQuery])
  useEffect(() => {
    if (linkedQuery === null) return
    setQuery(linkedQuery)
    setParams({}, { replace: true })
  }, [linkedQuery, setQuery, setParams])

  const people = useMemo(() => {
    const all = circle
      ? selectPeople(records).filter((p) => circle.memberIds.includes(p.id))
      : selectPeople(records)
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
  }, [records, query, circle])

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
      <h1 className="sr-only">People</h1>
      <form onSubmit={submit}>
        <input
          ref={searchRef}
          type="search"
          // Autofocus is a desktop convenience; on touch it pops the
          // keyboard over the Upcoming strip on every visit to this tab.
          autoFocus={
            typeof window !== 'undefined' &&
            window.matchMedia('(pointer: fine)').matches
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names, details, notes — or type a new name"
          aria-label="Search names, details, and notes"
        />
      </form>
      {circle && (
        <p className="banner circle-banner" style={{ '--chip-color': circle.color } as React.CSSProperties}>
          <span className="circle-chip">{circle.name}</span> — {circle.memberIds.length}{' '}
          {circle.memberIds.length === 1 ? 'person' : 'people'} ·{' '}
          <Link to={`/graph?circle=${circle.id}`}>see on graph</Link>
          <button className="subtle" onClick={() => setParams({}, { replace: true })}>
            Show everyone
          </button>
        </p>
      )}
      {!trimmed && !circle && !people.some((p) => !p.isSelf) && (
        <p className="empty">
          No one here yet. Type a name above and tap <strong>Add</strong>, or tap{' '}
          <strong>+</strong>.
        </p>
      )}
      {corrupted > 0 && (
        <p className="banner" role="alert">
          {corrupted} record{corrupted === 1 ? '' : 's'} could not be read and were
          skipped. Restore from a backup if something is missing.
        </p>
      )}
      <KdfUpgradeNag />
      <PinFailureNotice />
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
        <button
          className="add-person fab"
          // Name first: a nameless "New person" dumped at the bottom of a
          // long page is the confusing path. Focus the box and let the
          // typed name become the "+ Add" button.
          onClick={() => {
            const el = searchRef.current
            if (!el) return
            el.placeholder = 'Who did you meet? Type their name'
            el.focus()
          }}
          disabled={busy}
          aria-label="New person"
        >
          + <span className="fab-label">New person</span>
        </button>
      )}
    </div>
  )
}

function PersonRow({ person, query }: { person: Person; query: string }) {
  const records = useVaultStore((s) => s.records)
  const circles = useMemo(() => selectCirclesOf(records, person.id), [records, person.id])
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
            <span className="you-badge" title="This is you">
              you
            </span>
          )}
          {circles.length > 0 && (
            <span className="circle-dots" title={circles.map((c) => c.name).join(', ')}>
              {circles.map((c) => (
                <i key={c.id} style={{ background: c.color }} />
              ))}
            </span>
          )}
          {detail && <span className="hint"> {detail}</span>}
          {snippet && <span className="snippet">{snippet}</span>}
        </span>
        <span className="chev" aria-hidden="true">
          {'›'}
        </span>
      </Link>
    </li>
  )
}

/** Biometric/PIN unlocks can't migrate a legacy KDF wrap (§6.2). */
function KdfUpgradeNag() {
  const kdfLegacy = useVaultStore((s) => s.kdfLegacy)
  if (!kdfLegacy) return null
  return (
    <p className="banner">
      Security upgrade pending — lock and unlock once with your <em>passphrase</em> to
      finish upgrading the vault's key protection.
    </p>
  )
}

/** Tamper signal (§6.3): wrong PIN guesses made while the owner was away. */
function PinFailureNotice() {
  const count = useVaultStore((s) => s.pinFailureNotice)
  const clear = useVaultStore((s) => s.clearPinFailureNotice)
  if (count === 0) return null
  return (
    <p className="banner" role="alert">
      {count} failed PIN attempt{count === 1 ? '' : 's'} since your last unlock.{' '}
      <button className="subtle" onClick={clear}>
        Dismiss
      </button>
    </p>
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
        : 'Nothing backed up yet.'}{' '}
      Your notes live only on this device —{' '}
      <Link to="/settings">save a backup copy</Link> so they survive a cleared browser.
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
            <span className="hint">{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
