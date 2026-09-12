/**
 * "Add several" (§4.1 quick capture at scale): parse a pasted or typed
 * list of people, one per line, with an optional relationship after a
 * dash — "Sam Okafor — coworker". Pure and testable; the panel decides
 * what to do with the result.
 */
import type { Person, RelationshipType } from './models'

export interface BatchEntry {
  /** As typed, trimmed. */
  name: string
  /** Relationship label typed after the dash, if any (as typed). */
  typeLabel?: string
  /** Resolved type when the label matched one (case-insensitive). */
  type?: RelationshipType
  /** Someone with this name already exists — link, don't duplicate. */
  existing?: Person
}

const SEPARATOR = /\s+[—–-]\s+|\s*:\s+/
const TRAILING_SEPARATOR = /(\s+[—–-]|\s*:)$/

/**
 * Lines are entries. A line without a dash-separator may hold several
 * comma-separated names ("Sam, Priya, Theo"). Duplicates within the
 * batch collapse (case-insensitive) keeping the first spelling; empty
 * lines are skipped.
 */
export function parseBatch(
  text: string,
  types: readonly RelationshipType[],
  people: readonly Person[],
  /** Without a dossier to link to, a dash is just part of the name. */
  withTypes = true,
): BatchEntry[] {
  const typeByLabel = new Map(types.map((t) => [t.label.toLowerCase(), t]))
  const personByName = new Map(people.map((p) => [p.displayName.toLowerCase(), p]))
  const seen = new Set<string>()
  const out: BatchEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(TRAILING_SEPARATOR, '')
    if (!line) continue
    const parts = withTypes ? line.split(SEPARATOR) : [line]
    // "Sam, Priya — coworker": the type applies to every name before it.
    const names = parts[0].split(',')
    // Two separators ("Sam — friend, Priya — coworker") make no sense;
    // keep the tail as one unknown label so the UI can flag it.
    const typeLabel = parts.length > 1 ? parts.slice(1).join(' ').trim() : undefined
    for (const raw of names) {
      const name = raw.trim().replace(/^[@+]\s*/, '')
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        name,
        typeLabel: typeLabel || undefined,
        type: typeLabel ? typeByLabel.get(typeLabel.toLowerCase()) : undefined,
        existing: personByName.get(key),
      })
    }
  }
  return out
}
