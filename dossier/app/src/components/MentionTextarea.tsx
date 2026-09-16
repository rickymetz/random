import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { mentionToken } from '../lib/mentions'
import { rankPeople } from '../lib/names'
import Avatar from './Avatar'
import type { Person } from '../lib/models'

/** Word characters for a mention query — Unicode-aware so "@José" works. */
const WORD = '[\\p{L}\\p{N}_]'
// A mention may follow a quote, dash or slash too: “@Priya”, re: Sam—@Theo.
const QUERY_RE = new RegExp(`(^|[\\s.,;!?(\\["'“‘\\-–—/])@(${WORD}*(?: ${WORD}*)?)$`, 'u')
const TAIL_RE = new RegExp(`^${WORD}*`, 'u')

const MAX_SUGGESTIONS = 6

type Suggestion = { kind: 'person'; person: Person } | { kind: 'create'; name: string }

/**
 * Quick-capture textarea with @mention insertion (§4.1–4.2). Typing `@`
 * surfaces people (all of them for a bare "@", ranked by prefix match
 * as you type); picking one inserts a mention token that becomes a graph
 * edge on save. Fully keyboard-operable (arrows / Enter / Tab / Escape)
 * and pointer-friendly: suggestions insert on pointerdown (before blur)
 * so the mobile keyboard never flaps. A query with no match offers to
 * create the person on the spot — you're often typing about someone you
 * haven't filed yet (scenario S1).
 */
export default function MentionTextarea({
  people,
  value,
  onChange,
  onSubmit,
  onCreatePerson,
  placeholder,
  autoFocus,
  rows = 3,
  plain = false,
}: {
  people: Person[]
  value: string
  onChange: (value: string) => void
  /** Cmd/Ctrl+Enter. */
  onSubmit?: () => void
  onCreatePerson?: (name: string) => Promise<Person>
  placeholder?: string
  autoFocus?: boolean
  rows?: number
  /** Insert a picked person as plain `@Name` (the caller retokenizes on
   * save) instead of the `@[Name](id)` token — a capture box must not
   * fill with ids. */
  plain?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [activeRaw, setActive] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const pointerPicked = useRef(false)

  // An active mention query is a trailing "@word" (at most two words)
  // right before the caret — bounded so a stray "@" doesn't keep the
  // picker open for the whole rest of the sentence.
  const query = useMemo(() => {
    const upToCaret = value.slice(0, caret)
    const match = QUERY_RE.exec(upToCaret)
    if (!match) return null
    // In plain mode a finished "@Full Name " followed by more words is a
    // mention already made, not a query for the next word.
    if (plain) {
      const lower = match[2].toLowerCase()
      if (people.some((p) => lower.startsWith(p.displayName.toLowerCase() + ' '))) return null
    }
    return match[2]
  }, [value, caret, plain, people])

  const suggestions = useMemo((): Suggestion[] => {
    if (query === null || dismissed) return []
    const q = query.toLowerCase().trim()
    const ranked: Suggestion[] = rankPeople(people, q, MAX_SUGGESTIONS).map((person) => ({
      kind: 'person',
      person,
    }))
    const exact = people.some((p) => p.displayName.toLowerCase() === q)
    if (q.length >= 2 && !exact && onCreatePerson) {
      ranked.push({ kind: 'create', name: query.trim() })
    }
    return ranked
  }, [people, query, dismissed, onCreatePerson])

  useEffect(() => {
    setActive(0)
    setNavigated(false)
  }, [query, suggestions.length])
  // Announce matches without turning the textarea into a combobox (a
  // textarea cannot carry that role, so the list is described in words).
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    const n = suggestions.length
    if (!open) {
      setAnnounce('')
      return
    }
    const t = window.setTimeout(() => {
      const create = suggestions.some((s) => s.kind === 'create')
      const people = create ? n - 1 : n
      setAnnounce(
        people === 0
          ? `No one matches — Enter adds “${query?.trim() ?? ''}” as a new person`
          : `${people} ${people === 1 ? 'person matches' : 'people match'} — up and down to choose, Enter to insert`,
      )
    }, 350)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, query])

  const insertToken = (person: Person) => {
    if (query === null) return
    const start = caret - query.length - 1 // include the "@"
    // Consume any word characters continuing past the caret so a
    // mid-word pick doesn't strand the tail ("@an|n" → no orphan "n").
    const rest = value.slice(caret).replace(TAIL_RE, '')
    const token = plain ? `@${person.displayName}` : mentionToken(person)
    // One space after the token, but not two when the text already has one.
    const gap = rest.startsWith(' ') ? '' : ' '
    const next = value.slice(0, start) + token + gap + rest
    onChange(next)
    const el = ref.current
    if (el) {
      const pos = start + token.length + gap.length
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(pos, pos)
        setCaret(pos)
      })
    }
  }

  const pick = async (s: Suggestion | undefined) => {
    if (!s) return
    if (s.kind === 'person') return insertToken(s.person)
    const created = await onCreatePerson!(s.name)
    insertToken(created)
  }

  // Escape (and Tab) dismissed the list on keydown; their keyup must not
  // reopen it — only new typing or a click does.
  const track = (e?: { key?: string }) => {
    setCaret(ref.current?.selectionStart ?? 0)
    if (e?.key !== 'Escape' && e?.key !== 'Tab') setDismissed(false)
  }

  const open = suggestions.length > 0
  // `active` is state and the effect that resets it runs *after* render,
  // so a keystroke landing in that window indexes a list that has already
  // got shorter: arrow down to the third match, keep typing until one is
  // left, press Enter, and the note editor threw on `undefined.kind`.
  // Reading it clamped means the window can't exist.
  const active = Math.min(activeRaw, Math.max(0, suggestions.length - 1))
  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <div className="mention-box">
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder ?? 'Note'}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          setDismissed(false)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSubmit) {
            e.preventDefault()
            onSubmit()
            return
          }
          if (!open) return
          if (e.key === 'Escape') {
            e.preventDefault()
            setDismissed(true)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setNavigated(true)
            setActive((active + 1) % suggestions.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setNavigated(true)
            setActive((active - 1 + suggestions.length) % suggestions.length)
          } else if (e.key === 'Tab') {
            // Tab leaves the field; it never inserts.
            setDismissed(true)
          } else if (e.key === 'Enter' && (navigated || (query ?? '').trim())) {
            e.preventDefault()
            void pick(suggestions[active])
          }
        }}
        onKeyUp={track}
        onClick={() => track()}
      />
      <span className="sr-only" role="status">
        {announce}
      </span>
      {open && (
        <ul
          id={listId}
          className="mention-suggestions"
          role="listbox"
          aria-label="People to mention"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.kind === 'person' ? s.person.id : `create:${s.name}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              // The option itself is the target (no nested button — an
              // option's children are presentational). pointerdown only
              // keeps focus in the textarea so the keyboard stays up and
              // the caret math stays valid; click activates, which is
              // also what a screen reader's double-tap sends.
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
        </ul>
      )}
    </div>
  )
}
