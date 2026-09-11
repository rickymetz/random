import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { daysUntilDue, daysUntilNext, formatPartialDate } from '../lib/dates'
import type { Person } from '../lib/models'
import { matchSnippet } from '../lib/search'
import {
  searchPeopleIds,
  selectCircles,
  selectCirclesOf,
  selectNotes,
  selectPeople,
  selectSettings,
  useVaultStore,
} from '../store/vaultStore'

/** Rows rendered before the list asks for more (scroll or button). */
const PAGE = 60
const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
/** Below this many people the plain list needs neither Recent nor a rail. */
const RECENT_MIN_PEOPLE = 8
const RAIL_MIN_PEOPLE = 40
const RAIL_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

/** "Ada K." — a first name alone is ambiguous in a row of six. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toLocaleUpperCase()}.`
}

/** Letter a name files under on the rail: A–Z, or # for anything else. */
function letterOf(name: string): string {
  const c = name.trim().charAt(0).toLocaleUpperCase()
  return c >= 'A' && c <= 'Z' ? c : /\p{L}/u.test(c) ? c : '#'
}

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
  const setPersonCircles = useVaultStore((s) => s.setPersonCircles)
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

  // Sorted once per records snapshot; the query only narrows it.
  const sorted = useMemo(
    () => selectPeople(records).sort((a, b) => collator.compare(a.displayName, b.displayName)),
    [records],
  )
  const people = useMemo(() => {
    const all = circle ? sorted.filter((p) => circle.memberIds.includes(p.id)) : sorted
    const trimmed = query.trim()
    if (!trimmed) return all
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
  }, [sorted, query, circle])

  // Long lists render in pages: the first screenful is instant on a
  // phone with hundreds of people, and scrolling (or the button, for
  // keyboard and screen-reader users) reveals the rest. The window lives
  // in the store, keyed on query/circle, so Back from a dossier lands on
  // the same rows the browser is restoring the scroll position to.
  const pageKey = `${circle?.id ?? ''}|${query.trim()}`
  const homePage = useVaultStore((s) => s.homePage)
  const setHomePage = useVaultStore((s) => s.setHomePage)
  const limit = homePage.key === pageKey && homePage.limit > 0 ? homePage.limit : PAGE
  const pageKeyRef = useRef(pageKey)
  pageKeyRef.current = pageKey
  const growPage = () => {
    const key = pageKeyRef.current
    const cur = useVaultStore.getState().homePage
    const base = cur.key === key && cur.limit > 0 ? cur.limit : PAGE
    setHomePage({ key, limit: base + PAGE })
  }
  const sentinelRef = useRef<HTMLLIElement>(null)
  const hasMore = people.length > limit
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    // Start loading a couple of screens early so a fast scroll never
    // hits the end of the page.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) growPage()
      },
      { rootMargin: '800px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, limit, pageKey])
  // Letter headers make a long A–Z scroll navigable; only for the plain
  // list (a search or a circle is already a short, ranked set).
  const plainList = !query.trim() && !circle
  const showRecent = plainList && people.length > RECENT_MIN_PEOPLE
  // Letter headers, the count and the rail only once the list is long
  // enough to need them.
  const browsing = plainList && people.length > RAIL_MIN_PEOPLE
  const showRail = browsing

  // Jump rail: reveal enough rows for the letter, then scroll its header
  // under the app bar once those rows exist.
  const pendingJump = useRef<string | null>(null)
  const jumpTo = useCallback(
    (letter: string) => {
      const index = people.findIndex((p) => letterOf(p.displayName) === letter)
      if (index < 0) return
      pendingJump.current = letter
      const needed = Math.ceil((index + 1) / PAGE) * PAGE
      const cur = useVaultStore.getState().homePage
      const have = cur.key === pageKeyRef.current && cur.limit > 0 ? cur.limit : PAGE
      if (needed > have) setHomePage({ key: pageKeyRef.current, limit: needed })
      else scrollToLetter(letter)
    },
    [people, setHomePage],
  )
  useEffect(() => {
    const letter = pendingJump.current
    if (!letter) return
    if (scrollToLetter(letter)) pendingJump.current = null
  })

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const person = await addPerson(query.trim() || 'New person')
      // Adding from inside a circle's list puts the new person in it.
      if (circle) await setPersonCircles(person.id, [circle.id])
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
  // Circle names are searchable too — surface the circles themselves, not
  // just their members, and don't offer to create a *person* by that name.
  const circleHits = useMemo(() => {
    const q = trimmed.toLowerCase()
    if (!q || circle) return []
    return selectCircles(records).filter((c) => c.name.toLowerCase().includes(q))
  }, [records, trimmed, circle])
  const exactCircle = circleHits.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
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
          placeholder={
            circle
              ? `Search in ${circle.name}… or type a name to add`
              : 'Search names, details, notes — or type a new name'
          }
          aria-label="Search names, details, and notes"
        />
      </form>
      {circle && (
        <p
          className="banner circle-banner"
          role="status"
          style={{ '--chip-color': circle.color } as React.CSSProperties}
        >
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
      {circleHits.length > 0 && (
        <ul className="circle-results" aria-label="Circles">
          {circleHits.map((c) => (
            <li key={c.id}>
              <Link
                to={`/?circle=${c.id}`}
                className="circle-chip"
                style={{ '--chip-color': c.color } as React.CSSProperties}
              >
                {c.name}
              </Link>
              <span className="hint">
                {c.memberIds.length} {c.memberIds.length === 1 ? 'person' : 'people'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {trimmed && !exactCircle && (
        <button className="add-person" onClick={create} disabled={busy}>
          + Add “{trimmed}”{circle ? ` to ${circle.name}` : ''}
        </button>
      )}
      {showRecent && <Recent people={sorted} />}
      {browsing && (
        <p className="hint list-count" aria-live="polite">
          {people.length} people, A to Z
        </p>
      )}
      {showRail && <LetterRail people={people} onJump={jumpTo} />}
      <ul className={showRail ? 'with-rail' : undefined}>
        {people.slice(0, limit).map((p, i, shown) => {
          const letter = letterOf(p.displayName)
          const prev = i > 0 ? letterOf(shown[i - 1].displayName) : null
          return (
            <Fragment key={p.id}>
              {browsing && letter !== prev && (
                <li className="letter" data-letter={letter} aria-hidden="true">
                  {letter}
                </li>
              )}
              <PersonRow person={p} query={trimmed} />
            </Fragment>
          )
        })}
        {hasMore && (
          <li ref={sentinelRef} className="list-more">
            <button className="subtle" onClick={growPage}>
              Show more ({people.length - limit} remaining)
            </button>
          </li>
        )}
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

/**
 * Scroll so the letter's first row sits right under the app bar and its
 * sticky header. Not scrollIntoView on the header itself: a stuck sticky
 * header is "already in view", so the browser wouldn't move.
 */
function scrollToLetter(letter: string): boolean {
  const header = document.querySelector<HTMLElement>(`li.letter[data-letter="${letter}"]`)
  const row = header?.nextElementSibling as HTMLElement | null
  if (!header || !row) return false
  const bar = document.querySelector<HTMLElement>('.app-bar')?.getBoundingClientRect().height ?? 0
  const top = row.getBoundingClientRect().top + window.scrollY - bar - header.offsetHeight
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior })
  return true
}

/**
 * Right-edge A–Z rail (§4.4): tap or drag to jump. Letters nobody files
 * under are dimmed; a drag over one snaps to the next letter that has
 * people. Real buttons underneath, so it also works by keyboard and
 * screen reader.
 */
function LetterRail({ people, onJump }: { people: Person[]; onJump: (letter: string) => void }) {
  const present = useMemo(() => new Set(people.map((p) => letterOf(p.displayName))), [people])
  const railRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const lastJump = useRef<string | null>(null)

  const letterAt = (clientY: number): string | null => {
    const rail = railRef.current
    if (!rail) return null
    const rect = rail.getBoundingClientRect()
    const i = Math.floor(((clientY - rect.top) / rect.height) * RAIL_LETTERS.length)
    const clamped = Math.max(0, Math.min(RAIL_LETTERS.length - 1, i))
    // Snap to the nearest letter (looking down, then up) that has people.
    for (let j = clamped; j < RAIL_LETTERS.length; j++) {
      if (present.has(RAIL_LETTERS[j])) return RAIL_LETTERS[j]
    }
    for (let j = clamped - 1; j >= 0; j--) {
      if (present.has(RAIL_LETTERS[j])) return RAIL_LETTERS[j]
    }
    return null
  }
  const drag = (e: React.PointerEvent) => {
    const letter = letterAt(e.clientY)
    if (!letter) return
    setActive(letter)
    if (lastJump.current !== letter) {
      lastJump.current = letter
      onJump(letter)
    }
  }
  return (
    <nav
      ref={railRef}
      className={`letter-rail ${active ? 'dragging' : ''}`}
      aria-label="Jump to letter"
      onPointerDown={(e) => {
        e.preventDefault()
        railRef.current?.setPointerCapture(e.pointerId)
        lastJump.current = null
        drag(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return
        drag(e)
      }}
      onPointerUp={() => {
        setActive(null)
        lastJump.current = null
      }}
      onPointerCancel={() => setActive(null)}
    >
      {RAIL_LETTERS.map((l) => (
        <button
          key={l}
          type="button"
          tabIndex={present.has(l) ? 0 : -1}
          aria-disabled={!present.has(l)}
          className={l === active ? 'active' : ''}
          onClick={() => present.has(l) && onJump(l)}
          aria-label={`Jump to ${l === '#' ? 'other' : l}`}
        >
          {l}
        </button>
      ))}
      {active && (
        <span className="rail-bubble" aria-hidden="true">
          {active}
        </span>
      )}
    </nav>
  )
}

/**
 * The last few dossiers you opened (§4.4), newest first — with hundreds
 * of people, who you touched this week is what you scroll for. Kept in
 * the encrypted, device-local Settings record; a fresh device (or a
 * restore) falls back to the most recently updated people.
 */
function Recent({ people }: { people: Person[] }) {
  const records = useVaultStore((s) => s.records)
  const recentIds = selectSettings(records)?.recentIds
  const items = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p]))
    const fromVisits = (recentIds ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Person => Boolean(p) && !p!.isSelf)
    if (fromVisits.length > 0) return fromVisits.slice(0, 6)
    return [...people]
      .filter((p) => !p.isSelf)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
  }, [people, recentIds])
  if (items.length === 0) return null
  return (
    <section className="recent" aria-label="Recent">
      <h2>{recentIds?.length ? 'Recent' : 'Recently updated'}</h2>
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <Link to={`/person/${p.id}`} className="recent-item">
              <Avatar person={p} size={40} />
              <span className="recent-name">{shortName(p.displayName)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const PersonRow = memo(function PersonRow({ person, query }: { person: Person; query: string }) {
  const records = useVaultStore((s) => s.records)
  const circles = selectCirclesOf(records, person.id)
  const notes = selectNotes(records, person.id)
  const detail = [person.jobTitle, person.employer].filter(Boolean).join(' @ ')
  // Show WHY a result matched when the hit came from note text (§4.4).
  const snippet = useMemo(() => {
    if (!query) return null
    const q = query.toLowerCase()
    const nameHit = person.displayName.toLowerCase().includes(q) || detail.toLowerCase().includes(q)
    if (nameHit) return null
    // Say WHY it matched, the way note hits do: a structured field, a
    // circle, a tag — "the guy with the sailboat" needs the sailboat.
    const has = (v?: string) => Boolean(v && v.toLowerCase().includes(q))
    const nick = person.nicknames.find((n) => n.toLowerCase().includes(q))
    if (nick) return `aka ${nick}`
    if (has(person.location)) return `in ${person.location}`
    const tag = person.tags.find((t) => t.toLowerCase().includes(q))
    if (tag) return `tagged ${tag}`
    const like = person.likes.find((t) => t.toLowerCase().includes(q))
    if (like) return `likes ${like}`
    const dislike = person.dislikes.find((t) => t.toLowerCase().includes(q))
    if (dislike) return `dislikes ${dislike}`
    if (has(person.howWeMet)) return `met: ${person.howWeMet}`
    if (has(person.pronouns)) return person.pronouns ?? null
    const contact = [person.contact?.phone, person.contact?.email, person.contact?.other].find(has)
    if (contact) return contact
    const viaCircle = circles.find((c) => c.name.toLowerCase().includes(q))
    if (viaCircle) return `in ${viaCircle.name}`
    return matchSnippet(notes, query)
  }, [notes, person, query, detail, circles])

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
              <span className="sr-only">in {circles.map((c) => c.name).join(', ')}</span>
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
})

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
const UPCOMING_COLLAPSED = 3
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
    return list.sort((a, b) => a.days - b.days)
  }, [records, today])
  // Three rows by default: with hundreds of people the strip is always
  // full, and it must not push the list itself below the fold.
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, UPCOMING_COLLAPSED)

  if (items.length === 0) return null
  return (
    <section className="upcoming">
      <h2>
        Upcoming
        {items.length > UPCOMING_COLLAPSED && (
          <button className="subtle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show fewer' : `See all ${items.length}`}
          </button>
        )}
      </h2>
      <ul>
        {shown.map((item) => (
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
