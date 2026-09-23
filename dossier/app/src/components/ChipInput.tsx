import { useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * The value still being typed, folded into the list the way a commit
 * would: trimmed, and never a second copy of one already there. A form
 * calls this on save, because the chip field cannot commit it itself
 * (see the blur handler below).
 */
export function withDraft(values: string[], draft: string | undefined): string[] {
  const value = draft?.trim()
  if (!value) return values
  if (values.some((v) => v.toLowerCase() === value.toLowerCase())) return values
  return [...values, value]
}

/**
 * Chip-style list editor for tags/likes/dislikes/nicknames (§4.1
 * "tag-like lists, free-vocabulary"). Replaces comma-separated text:
 * values can contain commas, editing one value doesn't mean cursor-
 * hunting a long string, and suggestions from the existing vocabulary
 * keep "Climbing" and "climbing" from silently fragmenting the graph's
 * tag filter.
 */
export default function ChipInput({
  values,
  onChange,
  onDraftChange,
  suggestions = [],
  placeholder,
  label,
  labelId,
  suggestOnFocus = false,
  capitalize = 'none',
}: {
  values: string[]
  onChange: (values: string[]) => void
  /**
   * The half-typed value, reported as it changes. A form that can be
   * saved while this field has focus needs it: the field itself must not
   * turn it into a chip on the way out (see the blur handler).
   */
  onDraftChange?: (draft: string) => void
  suggestions?: string[]
  placeholder?: string
  label: string
  /** id of the visible label text; the group is labelled by it. */
  labelId?: string
  /** Offer the existing vocabulary as soon as the field is focused. */
  suggestOnFocus?: boolean
  /** Phone keyboard capitalisation: names and circles want 'words'. */
  capitalize?: 'none' | 'words'
}) {
  const [draft, setDraftState] = useState('')
  // The leftover is reported the way a commit would store it: an
  // existing spelling wins ("climbing crew" typed is "Climbing crew"), so
  // a word saved by the form's Save doesn't start a second spelling.
  const report = (next: string) => {
    if (!onDraftChange) return
    const t = next.trim().toLowerCase()
    onDraftChange(suggestions.find((sug) => sug.toLowerCase() === t) ?? next)
  }
  const setDraft = (next: string) => {
    setDraftState(next)
    report(next)
  }
  // Gone from the screen, gone from the form: a Cancel (or the field
  // closing) must not leave a word nobody can see to be saved next time.
  const reportRef = useRef(onDraftChange)
  reportRef.current = onDraftChange
  useEffect(() => () => reportRef.current?.(''), [])
  const [focused, setFocused] = useState(false)
  // Highlighted suggestion: Enter commits it (not the raw draft) so
  // "clim" becomes "Climbing crew" rather than a new "clim" value.
  const [active, setActive] = useState(-1)
  // Spoken: a chip added or removed is invisible to a screen reader.
  const [note, setNote] = useState('')
  const listId = useId()
  // A pointer pick fires on pointerdown (before the field can blur — Chrome
  // still moves focus even when pointerdown is cancelled); the click that
  // follows must not add twice. Keyboard/AT activation arrives as a bare
  // click and goes through.
  const pointerPicked = useRef(false)
  const valuesRef = useRef(values)
  valuesRef.current = values

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const present = new Set(values.map((v) => v.toLowerCase()))
    if (!q) {
      return suggestOnFocus && focused
        ? suggestions.filter((s) => !present.has(s.toLowerCase())).slice(0, 6)
        : []
    }
    // Substring, not prefix: "club" finds "Book club".
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !present.has(s.toLowerCase()))
      .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
      .slice(0, 6)
  }, [draft, suggestions, values, suggestOnFocus, focused])

  useEffect(() => {
    setActive(-1)
  }, [draft, matches.length])

  // One onChange per call, even for multiple entries — two add() calls
  // against the same render's `values` would overwrite each other.
  const add = (...raws: string[]) => {
    // Always from the latest values: a blur-commit and a pick can land in
    // the same tick, and the second must not overwrite the first.
    const current = valuesRef.current
    let next = current
    for (const raw of raws) {
      const value = raw.trim()
      if (!value) continue
      // Case-insensitive dedupe, but reuse the existing vocabulary's
      // casing so one spelling wins across all people.
      const canonical =
        suggestions.find((s) => s.toLowerCase() === value.toLowerCase()) ?? value
      if (!next.some((v) => v.toLowerCase() === canonical.toLowerCase())) {
        next = [...next, canonical]
      }
    }
    if (next !== current) {
      valuesRef.current = next
      onChange(next)
      setNote(`Added ${next.slice(current.length).join(', ')}`)
    }
    setDraft('')
  }

  const removeAt = (index: number) => {
    setNote(`Removed ${values[index]}`)
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="chip-input" role="group" aria-label={labelId ? undefined : label} aria-labelledby={labelId}>
      <span className="sr-only" role="status">
        {note}
      </span>
      <div className="chip-row">
        {values.map((value, i) => (
          <span key={`${value}-${i}`} className="value-chip">
            {value}
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove ${value}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-label={`Add ${label}`}
          autoCapitalize={capitalize}
          autoComplete="off"
          enterKeyHint="done"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          aria-controls={matches.length > 0 ? listId : undefined}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            // A typed comma commits the value — the old habit keeps working.
            if (e.target.value.includes(',')) {
              add(...e.target.value.split(','))
            } else {
              setDraft(e.target.value)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Never let Enter fall through to the form: an empty chip
              // field would submit and close the whole edit.
              e.preventDefault()
              if (active >= 0 && matches[active]) add(matches[active])
              else if (draft.trim()) add(draft)
            } else if (e.key === 'ArrowDown' && matches.length > 0) {
              e.preventDefault()
              setActive((i) => (i + 1) % matches.length)
            } else if (e.key === 'ArrowUp' && matches.length > 0) {
              e.preventDefault()
              setActive((i) => (i <= 0 ? matches.length - 1 : i - 1))
            } else if (e.key === 'Escape' && matches.length > 0) {
              e.preventDefault()
              setActive(-1)
              setFocused(false)
            } else if (e.key === 'Backspace' && !draft && values.length > 0) {
              removeAt(values.length - 1)
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false)
            // Never grow the field on the way to a button. Committing
            // here adds a chip, the chip wraps onto a new line, the
            // button moves out from under the finger between press and
            // release — and the tap is never delivered at all: measured
            // at 33px of drift and no click event. The word is not lost
            // either: the form takes it with `withDraft` on save.
            if ((e.relatedTarget as HTMLElement | null)?.tagName === 'BUTTON') return
            // Otherwise commit a real word left behind, not a stray key.
            if (draft.trim().length >= 2) add(draft)
            else if (draft.trim().length < 2) setDraft('')
          }}
        />
      </div>
      {matches.length > 0 && (
        <ul className="chip-suggestions" id={listId} role="listbox" aria-label={`${label} suggestions`}>
          {matches.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onPointerDown={(e) => {
                e.preventDefault()
                pointerPicked.current = true
                add(s)
              }}
              onClick={() => {
                if (!pointerPicked.current) add(s)
                pointerPicked.current = false
              }}
              onPointerEnter={() => setActive(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
