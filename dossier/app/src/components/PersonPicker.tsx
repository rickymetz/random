import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { rankPeople } from '../lib/names'
import type { Person } from '../lib/models'
import Avatar from './Avatar'

const MAX = 8

type Suggestion = { kind: 'person'; person: Person } | { kind: 'create'; name: string }

/**
 * Typeahead person field (§4.2): type a name, pick from ranked matches,
 * or add someone who isn't filed yet. Replaces the native <select> that
 * listed every person — a 300-item picker wheel on a phone.
 *
 * Combobox per the ARIA pattern: the input owns focus, the listbox is
 * driven by aria-activedescendant, options activate on click (so a
 * screen reader's double-tap works) with pointerdown only keeping focus
 * in the field. Nothing is auto-selected when the list opens on focus;
 * typing highlights the top match so Enter picks it. Tab never picks.
 * A picked person renders as a chip whose "change" button takes focus,
 * so the pick is announced and Tab continues to the next field.
 */
export default function PersonPicker({
  people,
  excludeIds,
  value,
  onChange,
  onCreate,
  label,
  placeholder = 'Type a name…',
  emptyLabel,
  pickedMessage,
  listAbove,
  preferIds,
  className,
}: {
  /** Everyone who could be named — used for the exact-name check too. */
  people: Person[]
  /** Never offered (the page's own person, existing members…). */
  excludeIds?: readonly string[]
  /** Selected person id, or '' for none. */
  value: string
  onChange: (personId: string) => void
  /** Offered as "+ Add “Name”" when the query matches nobody exactly. */
  onCreate?: (name: string) => Promise<Person>
  label: string
  placeholder?: string
  /** What '' means, shown as a chip ("You" in "mutual connections with"). */
  emptyLabel?: string
  /** Announced after a pick instead of "Name selected". */
  pickedMessage?: (person: Person) => string
  /** Open the list upward (inside a bottom-anchored card). */
  listAbove?: boolean
  /** Ids to list first when nothing is typed (recently opened dossiers). */
  preferIds?: readonly string[]
  className?: string
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState('')
  const [focusChip, setFocusChip] = useState(false)
  // Pointer picks happen on pointerdown, before the field can blur; the
  // click that follows is skipped. A bare click (keyboard/AT) still picks.
  const pointerPicked = useRef(false)

  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds])
  const candidates = useMemo(
    () => (excluded.size ? people.filter((p) => !excluded.has(p.id)) : people),
    [people, excluded],
  )
  const byId = useMemo(() => new Map(candidates.map((p) => [p.id, p])), [candidates])
  const picked = value ? byId.get(value) : undefined

  // A value that no longer resolves (person deleted) must not stay
  // silently selected behind an empty-looking field.
  useEffect(() => {
    if (value && !picked) onChange('')
  }, [value, picked, onChange])

  const q = query.trim()
  const { suggestions, more } = useMemo(() => {
    let ranked: Person[]
    let more: number
    if (q === '') {
      // Nothing typed: the people you opened most recently, then A–Z —
      // seven "Ada …" rows told a 300-person vault nothing.
      const recent = (preferIds ?? [])
        .map((id) => byId.get(id))
        .filter((p): p is Person => p !== undefined)
      const seen = new Set(recent.map((p) => p.id))
      const rest = rankPeople(
        candidates.filter((p) => !seen.has(p.id)),
        '',
        Math.max(0, MAX + 1 - recent.length),
      )
      ranked = [...recent.slice(0, MAX), ...rest]
      more = Math.max(0, candidates.length - MAX)
    } else {
      ranked = rankPeople(candidates, q, MAX + 1)
      more = Math.max(0, ranked.length - MAX)
    }
    const list: Suggestion[] = ranked
      .slice(0, MAX)
      .map((person) => ({ kind: 'person', person }))
    // Exact-name check runs over everyone, so the page's own person (or
    // an existing member) is never offered as a duplicate to create. The
    // create row waits for a plausible name (three letters or two words)
    // and never hides as a ninth row under a full list.
    const exact = people.some((p) => p.displayName.toLowerCase() === q.toLowerCase())
    const plausible = q.length >= 3 || /\s/.test(q)
    if (plausible && !exact && onCreate && list.length < MAX) list.push({ kind: 'create', name: q })
    return { suggestions: list, more }
  }, [candidates, byId, people, q, onCreate, preferIds])

  // Typing highlights the top match; opening on focus highlights nothing.
  useEffect(() => {
    setActive(q ? 0 : -1)
  }, [q, suggestions.length])

  // Polite result count, debounced so it doesn't chatter per keystroke.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const n = suggestions.filter((s) => s.kind === 'person').length
      setStatus(
        n === 0
          ? q
            ? `No one called “${q}”${onCreate && q.length >= 2 ? ' — press Enter to add them' : ''}`
            : ''
          : `${n} ${n === 1 ? 'match' : 'matches'}${more ? `, ${more} more — keep typing` : ''}. Use up and down arrows.`,
      )
    }, 300)
    return () => clearTimeout(t)
  }, [open, suggestions, more, q, onCreate])

  // After a pick the input is replaced by the chip: hand focus to its
  // change button so the reading position follows and Tab continues.
  useEffect(() => {
    if (focusChip && (picked || (emptyLabel && !editing))) {
      changeRef.current?.focus()
      setFocusChip(false)
    }
  }, [focusChip, picked, emptyLabel, editing])

  const pick = async (s: Suggestion) => {
    if (busy) return
    let person: Person
    if (s.kind === 'person') {
      person = s.person
    } else {
      setBusy(true)
      setStatus(`Adding ${s.name}…`)
      try {
        person = await onCreate!(s.name)
      } catch {
        setStatus(`Could not add ${s.name} — try again.`)
        setBusy(false)
        return
      }
      setBusy(false)
    }
    setQuery('')
    setOpen(false)
    setEditing(false)
    setStatus(pickedMessage ? pickedMessage(person) : `${person.displayName} selected`)
    onChange(person.id)
    setFocusChip(true)
  }
  const startEditing = () => {
    onChange('')
    setQuery('')
    setEditing(true)
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  const onRootBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    // Give a screen reader's cursor a beat before the list goes away.
    setTimeout(() => {
      if (rootRef.current?.contains(document.activeElement)) return
      setOpen(false)
      // Nothing chosen: an abandoned query would look like a choice.
      setQuery('')
      setEditing(false)
    }, 150)
  }

  const showList = open && suggestions.length > 0
  const optionId = (i: number) => `${listId}-opt-${i}`
  const chipName = picked?.displayName ?? (emptyLabel && !editing ? emptyLabel : undefined)

  return (
    <div
      ref={rootRef}
      className={`person-picker ${chipName ? 'picked' : ''} ${listAbove ? 'list-above' : ''} ${className ?? ''}`}
      onBlur={onRootBlur}
    >
      {chipName ? (
        <div className="picked-chip" role="group" aria-label={`${label}: ${chipName}`}>
          {picked && <Avatar person={picked} size={24} />}
          <span>{chipName}</span>
          <button
            ref={changeRef}
            type="button"
            className="subtle icon"
            onClick={startEditing}
            aria-label={`Change ${label.toLowerCase()} (currently ${chipName})`}
          >
            {picked ? '×' : '✎'}
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            value={query}
            placeholder={placeholder}
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            aria-busy={busy || undefined}
            readOnly={busy}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              // The keyboard's own reveal parks the field under the sticky
              // app bar; bring it (and room for the list) into view.
              requestAnimationFrame(() =>
                inputRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }),
              )
            }}
            onKeyDown={(e) => {
              if (busy) return
              if (e.key === 'Escape') {
                if (open) {
                  // Ours, not the enclosing card's (a peek closes on Escape).
                  e.preventDefault()
                  e.stopPropagation()
                  setOpen(false)
                } else if (query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuery('')
                }
                return
              }
              if (e.key === 'Tab') {
                setOpen(false)
                return
              }
              if (!showList) {
                if (e.key === 'ArrowDown') setOpen(true)
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => (i + 1) % suggestions.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
              } else if (e.key === 'Enter') {
                // Picks the highlighted (or, after typing, the top) match;
                // never submits the surrounding form.
                e.preventDefault()
                const s = suggestions[active >= 0 ? active : 0]
                if (s && (active >= 0 || q)) void pick(s)
              }
            }}
          />
          {showList && (
            <ul id={listId} className="chip-suggestions" role="listbox" aria-label="Matching people">
              {suggestions.map((s, i) => (
                <li
                  key={s.kind === 'person' ? s.person.id : `create:${s.name}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : undefined}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    pointerPicked.current = true
                    void pick(s)
                  }}
                  onClick={() => {
                    if (!pointerPicked.current) void pick(s)
                    pointerPicked.current = false
                  }}
                  onPointerEnter={() => setActive(i)}
                >
                  {s.kind === 'person' ? (
                    <>
                      <Avatar person={s.person} size={28} />
                      <span className="picker-name">
                        <span className="picker-name-text">{s.person.displayName}</span>
                        {(s.person.jobTitle || s.person.employer) && (
                          <span className="hint">
                            {[s.person.jobTitle, s.person.employer].filter(Boolean).join(' @ ')}
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="picker-create">+ Add “{s.name}”</span>
                  )}
                </li>
              ))}
              {more > 0 && (
                <li className="picker-more hint" aria-hidden="true">
                  {more} more — keep typing
                </li>
              )}
            </ul>
          )}
          {open && q.length > 0 && suggestions.length === 0 && (
            <p className="picker-empty hint">No one called “{q}”</p>
          )}
        </>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  )
}
