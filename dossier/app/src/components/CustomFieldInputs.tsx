/**
 * The rows this vault added to the person form (REQUIREMENTS.md §8.1).
 *
 * One input per field type. Dates are held as text while you type and
 * parsed on save, exactly as the built-in birthday is — a half-typed
 * date must never be read as an empty one and thrown away.
 */
import { useMemo } from 'react'
import ChipInput from './ChipInput'
import { formatPartialDate } from '../lib/dates'
import type { CustomValue, FieldDef, Person } from '../lib/models'
import { blankValue } from '../lib/fieldDefs'

/** While editing, a date field holds the text you typed. */
export type DraftValue = CustomValue | string

export function draftFrom(defs: FieldDef[], person: Person): Record<string, DraftValue> {
  const out: Record<string, DraftValue> = {}
  for (const def of defs) {
    const value = person.custom?.[def.id]
    if (def.type === 'date') {
      out[def.id] = value && typeof value === 'object' && !Array.isArray(value)
        ? formatPartialDate(value)
        : ''
    } else {
      out[def.id] = value ?? blankValue(def.type)
    }
  }
  return out
}

/** What other people answered here, so spellings converge (§4.1). */
function vocabFor(people: Person[], fieldId: string): string[] {
  const seen = new Map<string, string>()
  for (const p of people) {
    const value = p.custom?.[fieldId]
    if (!Array.isArray(value)) continue
    for (const v of value) seen.set(v.toLowerCase(), v)
  }
  return [...seen.values()].sort()
}

export default function CustomFieldInputs({
  defs,
  people,
  draft,
  onChange,
  errors,
  clearError,
}: {
  defs: FieldDef[]
  people: Person[]
  draft: Record<string, DraftValue>
  onChange: (fieldId: string, value: DraftValue) => void
  errors: Record<string, string>
  clearError: (fieldId: string) => void
}) {
  const vocab = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const def of defs) if (def.type === 'chips') out[def.id] = vocabFor(people, def.id)
    return out
  }, [defs, people])

  return (
    <div className="field-grid">
      {defs.map((def) => {
        const value = draft[def.id]
        const errorId = `custom-error-${def.id}`
        const error = errors[def.id]
        switch (def.type) {
          case 'chips':
            return (
              <div key={def.id} className="span-2 field-label">
                <span id={`chip-label-${def.id}`}>{def.label}</span>
                <ChipInput
                  label={def.label}
                  labelId={`chip-label-${def.id}`}
                  values={Array.isArray(value) ? value : []}
                  onChange={(values) => onChange(def.id, values)}
                  suggestions={vocab[def.id] ?? []}
                  placeholder="one per entry"
                  suggestOnFocus
                />
              </div>
            )
          case 'longText':
            return (
              <label key={def.id} className="span-2">
                {def.label}
                <textarea
                  rows={2}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(def.id, e.target.value)}
                />
              </label>
            )
          case 'boolean':
            return (
              <label key={def.id} className="toggle-row span-2">
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => onChange(def.id, e.target.checked)}
                />
                <span>{def.label}</span>
              </label>
            )
          case 'number':
            return (
              <label key={def.id}>
                {def.label}
                <input
                  type="number"
                  inputMode="decimal"
                  value={typeof value === 'number' ? value : ''}
                  onChange={(e) =>
                    onChange(def.id, e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
              </label>
            )
          case 'choice':
            return (
              <label key={def.id} className="inline-field">
                <span>{def.label}</span>
                <select
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(def.id, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {/* An answer that is no longer an option still shows,
                      rather than silently becoming "Choose…". */}
                  {[
                    ...(def.options ?? []),
                    ...(typeof value === 'string' && value && !(def.options ?? []).includes(value)
                      ? [value]
                      : []),
                  ].map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
            )
          case 'date':
            return (
              <label key={def.id}>
                {def.label}
                <input
                  value={typeof value === 'string' ? value : ''}
                  placeholder="Jun 21 or 1984-06-21"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  onInput={() => clearError(def.id)}
                  onChange={(e) => onChange(def.id, e.target.value)}
                />
                {error && (
                  <span className="field-error" role="alert" id={errorId}>
                    {error}
                  </span>
                )}
              </label>
            )
          default:
            return (
              <label key={def.id}>
                {def.label}
                <input
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(def.id, e.target.value)}
                />
              </label>
            )
        }
      })}
    </div>
  )
}
