import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { mentionToken } from '../lib/mentions'
import { rankPeople } from '../lib/names'
import type { Person } from '../lib/models'

/** Word characters for a mention query — Unicode-aware so "@José" works. */
const WORD = '[\\p{L}\\p{N}_]'
const QUERY_RE = new RegExp(`(^|[\\s.,;!?(])@(${WORD}*(?: ${WORD}*)?)$`, 'u')
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
}: {
  people: Person[]
  value: string
  onChange: (value: string) => void
  /** Cmd/Ctrl+Enter. */
  onSubmit?: () => void
  onCreatePerson?: (name: string) => Promise<Person>
  placeholder?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)

  // An active mention query is a trailing "@word" (at most two words)
  // right before the caret — bounded so a stray "@" doesn't keep the
  // picker open for the whole rest of the sentence.
  const query = useMemo(() => {
    const upToCaret = value.slice(0, caret)
    const match = QUERY_RE.exec(upToCaret)
    return match ? match[2] : null
  }, [value, caret])

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
  }, [query, suggestions.length])

  const insertToken = (person: Person) => {
    if (query === null) return
    const start = caret - query.length - 1 // include the "@"
    // Consume any word characters continuing past the caret so a
    // mid-word pick doesn't strand the tail ("@an|n" → no orphan "n").
    const rest = value.slice(caret).replace(TAIL_RE, '')
    const token = mentionToken(person)
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

  const pick = async (s: Suggestion) => {
    if (s.kind === 'person') return insertToken(s.person)
    const created = await onCreatePerson!(s.name)
    insertToken(created)
  }

  const track = () => {
    setCaret(ref.current?.selectionStart ?? 0)
    setDismissed(false)
  }

  const open = suggestions.length > 0
  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <div className="mention-box">
      <textarea
        ref={ref}
        rows={3}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder ?? 'Note'}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
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
            setActive((i) => (i + 1) % suggestions.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            void pick(suggestions[active])
          }
        }}
        onKeyUp={track}
        onClick={track}
      />
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
            >
              <button
                type="button"
                tabIndex={-1}
                // pointerdown fires before the textarea's blur, so the
                // keyboard stays up and the caret math stays valid.
                onPointerDown={(e) => {
                  e.preventDefault()
                  void pick(s)
                }}
                onPointerEnter={() => setActive(i)}
              >
                {s.kind === 'person' ? s.person.displayName : `+ Add “${s.name}”`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
