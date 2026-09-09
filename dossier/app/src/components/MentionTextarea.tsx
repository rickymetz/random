import { useMemo, useRef, useState } from 'react'
import { mentionToken } from '../lib/mentions'
import type { Person } from '../lib/models'

/**
 * Quick-capture textarea with @mention insertion (§4.1–4.2). Typing `@`
 * plus letters surfaces matching people; picking one inserts a mention
 * token that becomes a graph edge on save.
 */
export default function MentionTextarea({
  people,
  value,
  onChange,
  placeholder,
}: {
  people: Person[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)

  // An active mention query is a trailing "@word" right before the caret,
  // not already part of an inserted token (tokens contain "](").
  const query = useMemo(() => {
    const upToCaret = value.slice(0, caret)
    const match = /(^|[\s.,;!?])@(\w[\w ]*)$/.exec(upToCaret)
    return match ? match[2] : null
  }, [value, caret])

  const suggestions = useMemo(() => {
    if (query === null) return []
    const q = query.toLowerCase()
    return people
      .filter(
        (p) =>
          p.displayName.toLowerCase().startsWith(q) ||
          p.nicknames.some((n) => n.toLowerCase().startsWith(q)),
      )
      .slice(0, 5)
  }, [people, query])

  const insert = (person: Person) => {
    if (query === null) return
    const start = caret - query.length - 1 // include the "@"
    const next = value.slice(0, start) + mentionToken(person) + ' ' + value.slice(caret)
    onChange(next)
    const el = ref.current
    if (el) {
      const pos = start + mentionToken(person).length + 1
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(pos, pos)
        setCaret(pos)
      })
    }
  }

  const track = () => setCaret(ref.current?.selectionStart ?? 0)

  return (
    <div className="mention-box">
      <textarea
        ref={ref}
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
        }}
        onKeyUp={track}
        onClick={track}
      />
      {suggestions.length > 0 && (
        <div className="mention-suggestions" role="listbox">
          {suggestions.map((p) => (
            <button key={p.id} type="button" onClick={() => insert(p)}>
              {p.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
