import { useMemo, useState } from 'react'

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
}: {
  values: string[]
  onChange: (values: string[]) => void
  suggestions?: string[]
  placeholder?: string
  label: string
}) {
  const [draft, setDraft] = useState('')

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q) return []
    const present = new Set(values.map((v) => v.toLowerCase()))
    return suggestions
      .filter((s) => s.toLowerCase().startsWith(q) && !present.has(s.toLowerCase()))
      .slice(0, 5)
  }, [draft, suggestions, values])

  // One onChange per call, even for multiple entries — two add() calls
  // against the same render's `values` would overwrite each other.
  const add = (...raws: string[]) => {
    let next = values
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
    if (next !== values) onChange(next)
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
          autoCapitalize="none"
          autoComplete="off"
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
              if (draft.trim()) {
                e.preventDefault()
                add(draft)
              }
            } else if (e.key === 'Backspace' && !draft && values.length > 0) {
              removeAt(values.length - 1)
            }
          }}
          onBlur={() => {
            if (draft.trim()) add(draft)
          }}
        />
      </div>
      {matches.length > 0 && (
        <div className="chip-suggestions">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault()
                add(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
