import { useEffect, useId, useMemo, useRef, useState } from 'react'

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
  suggestions = [],
  placeholder,
  label,
  suggestOnFocus = false,
  capitalize = 'none',
}: {
  values: string[]
  onChange: (values: string[]) => void
  suggestions?: string[]
  placeholder?: string
  label: string
  /** Offer the existing vocabulary as soon as the field is focused. */
  suggestOnFocus?: boolean
  /** Phone keyboard capitalisation: names and circles want 'words'. */
  capitalize?: 'none' | 'words'
}) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  // Highlighted suggestion: Enter commits it (not the raw draft) so
  // "clim" becomes "Climbing crew" rather than a new "clim" value.
  const [active, setActive] = useState(-1)
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
    }
    setDraft('')
  }

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="chip-input" role="group" aria-label={label}>
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
            // Commit a real word left in the field, not a stray keystroke,
            // and not when the blur is a tap on Cancel/Save.
            const toButton = (e.relatedTarget as HTMLElement | null)?.tagName === 'BUTTON'
            if (draft.trim().length >= 2 && !toButton) add(draft)
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
