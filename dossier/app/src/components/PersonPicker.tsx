import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { rankPeople } from '../lib/names'
import type { Person } from '../lib/models'
import Avatar from './Avatar'

const MAX = 8

type Suggestion = { kind: 'person'; person: Person } | { kind: 'create'; name: string }

/**
 * Typeahead person field (§4.2): type a name, pick from ranked matches,
 * or add someone who isn't filed yet. Replaces the native <select> that
 * listed every person — a 300-item picker wheel on a phone. A picked
 * person shows as a chip with a × to change; the list is a combobox
 * (arrows / Enter / Escape, pointer picks before blur so the keyboard
 * stays put).
 */
export default function PersonPicker({
  people,
  value,
  onChange,
  onCreate,
  label,
  placeholder = 'Type a name…',
  autoFocus,
  className,
}: {
  /** Candidates (already excluding whoever must not be picked). */
  people: Person[]
  /** Selected person id, or '' for none. */
  value: string
  onChange: (personId: string) => void
  /** Offered as "+ Add “Name”" when the query matches nobody exactly. */
  onCreate?: (name: string) => Promise<Person>
  label: string
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const picked = value ? byId.get(value) : undefined

  const suggestions = useMemo((): Suggestion[] => {
    const ranked: Suggestion[] = rankPeople(people, query, MAX).map((person) => ({
      kind: 'person',
      person,
    }))
    const q = query.trim()
    const exact = people.some((p) => p.displayName.toLowerCase() === q.toLowerCase())
    if (q.length >= 2 && !exact && onCreate) ranked.push({ kind: 'create', name: q })
    return ranked
  }, [people, query, onCreate])

  useEffect(() => {
    setActive(0)
  }, [query, suggestions.length])

  const pick = async (s: Suggestion) => {
    if (busy) return
    if (s.kind === 'person') {
      onChange(s.person.id)
    } else {
      setBusy(true)
      try {
        const created = await onCreate!(s.name)
        onChange(created.id)
      } finally {
        setBusy(false)
      }
    }
    setQuery('')
    setOpen(false)
  }
  const clear = () => {
    onChange('')
    setQuery('')
    // Back to typing straight away — changing your mind is one tap.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const showList = open && suggestions.length > 0
  const optionId = (i: number) => `${listId}-opt-${i}`

  if (picked) {
    return (
      <div className={`person-picker picked ${className ?? ''}`}>
        <span className="picked-chip">
          <Avatar person={picked} size={24} />
          <span>{picked.displayName}</span>
          <button
            type="button"
            className="subtle icon"
            onClick={clear}
            aria-label={`Change person (currently ${picked.displayName})`}
          >
            ×
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className={`person-picker ${className ?? ''}`}>
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
        aria-activedescendant={showList ? optionId(active) : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={busy}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (open) {
              e.preventDefault()
              setOpen(false)
            }
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
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            // Enter picks instead of submitting the surrounding form.
            if (e.key === 'Enter') e.preventDefault()
            if (e.key === 'Tab' && query.trim() === '') return
            e.preventDefault()
            void pick(suggestions[active])
          }
        }}
      />
      {showList && (
        <ul id={listId} className="chip-suggestions" role="listbox" aria-label={label}>
          {suggestions.map((s, i) => (
            <li
              key={s.kind === 'person' ? s.person.id : `create:${s.name}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
            >
              <button
                type="button"
                tabIndex={-1}
                onPointerDown={(e) => {
                  e.preventDefault()
                  void pick(s)
                }}
                onPointerEnter={() => setActive(i)}
              >
                {s.kind === 'person' ? (
                  <>
                    <Avatar person={s.person} size={28} />
                    <span className="picker-name">
                      {s.person.displayName}
                      {(s.person.jobTitle || s.person.employer) && (
                        <span className="hint">
                          {[s.person.jobTitle, s.person.employer].filter(Boolean).join(' @ ')}
                        </span>
                      )}
                    </span>
                  </>
                ) : (
                  `+ Add “${s.name}”`
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
