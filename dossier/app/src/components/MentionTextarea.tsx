import { useMemo, useRef, useState } from 'react'
import { mentionToken } from '../lib/mentions'
import type { Person } from '../lib/models'

/**
 * Quick-capture textarea with @mention insertion (§4.1–4.2). Typing `@`
 * plus letters surfaces matching people; picking one inserts a mention
 * token that becomes a graph edge on save. Suggestions insert on
 * pointerdown (before blur) so the mobile keyboard never flaps, and
 * matching covers any word of the name — "@smith" finds John Smith.
 */
export default function MentionTextarea({
  people,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  people: Person[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  // An active mention query is a trailing "@word" (at most two words)
  // right before the caret — bounded so a stray "@" doesn't keep the
  // picker open for the whole rest of the sentence.
  const query = useMemo(() => {
    const upToCaret = value.slice(0, caret)
    const match = /(^|[\s.,;!?(])@(\w+(?: \w*)?)$/.exec(upToCaret)
    return match ? match[2] : null
  }, [value, caret])

  const suggestions = useMemo(() => {
    if (query === null || dismissed) return []
    const q = query.toLowerCase()
    const wordMatch = (name: string) =>
      name.toLowerCase().includes(q) ||
      name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q))
    return people
      .filter((p) => wordMatch(p.displayName) || p.nicknames.some(wordMatch))
      .slice(0, 5)
  }, [people, query, dismissed])

  const insert = (person: Person) => {
    if (query === null) return
    const start = caret - query.length - 1 // include the "@"
    // Consume any word characters continuing past the caret so a
    // mid-word pick doesn't strand the tail ("@an|n" → no orphan "n").
    const rest = value.slice(caret).replace(/^\w*/, '')
    const token = mentionToken(person)
    const next = value.slice(0, start) + token + ' ' + rest
    onChange(next)
    const el = ref.current
    if (el) {
      const pos = start + token.length + 1
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(pos, pos)
        setCaret(pos)
      })
    }
  }

  const track = () => {
    setCaret(ref.current?.selectionStart ?? 0)
    setDismissed(false)
  }

  return (
    <div className="mention-box">
      <textarea
        ref={ref}
        rows={3}
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
          if (e.key === 'Escape' && suggestions.length > 0) {
            e.preventDefault()
            setDismissed(true)
          }
        }}
        onKeyUp={track}
        onClick={track}
      />
      {suggestions.length > 0 && (
        <ul className="mention-suggestions" role="listbox" aria-label="People to mention">
          {suggestions.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                tabIndex={-1}
                // pointerdown fires before the textarea's blur, so the
                // keyboard stays up and the caret math stays valid.
                onPointerDown={(e) => {
                  e.preventDefault()
                  insert(p)
                }}
              >
                {p.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
