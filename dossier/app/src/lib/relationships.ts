/**
 * Roles on a link (§4.2): two people can be joined by several
 * relationships at once — coworker and former partner — each its own
 * record, each with an optional start, end and "former" flag. This
 * module holds the vocabulary around that: pair keys, labels, the batch
 * aliases ("ex", "former coworker"), and the one migration that turned
 * the old built-in "ex" type into "partner, former".
 */
import { formatPartialDate } from './dates'
import type { DomainRecord, Relationship, RelationshipType } from './models'

/** Order-independent key for the pair a relationship joins. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** "partner" / "former partner" — the role as people say it. */
export function roleLabel(typeLabel: string, edge: Pick<Relationship, 'former'>): string {
  return edge.former ? `former ${typeLabel}` : typeLabel
}

/** "2019–2021", "since 2019", "until 2021", or '' when undated. */
export function roleDates(edge: Pick<Relationship, 'startDate' | 'endDate'>): string {
  const from = edge.startDate ? formatPartialDate(edge.startDate) : ''
  const to = edge.endDate ? formatPartialDate(edge.endDate) : ''
  if (from && to) return `${from}–${to}`
  if (from) return `since ${from}`
  if (to) return `until ${to}`
  return ''
}

/**
 * Resolve a typed role label to a type and a former flag. "ex" and
 * "ex-partner" mean a former partner; "former coworker" / "ex coworker"
 * / "old boss of" mean that type, former. Case-insensitive.
 */
export function parseRoleLabel(
  label: string,
  types: readonly RelationshipType[],
): { type?: RelationshipType; former: boolean } {
  const byLabel = new Map(types.map((t) => [t.label.toLowerCase(), t]))
  const raw = label.trim().toLowerCase()
  if (!raw) return { former: false }
  if (raw === 'ex') return { type: byLabel.get('partner'), former: true }
  const m = /^(?:ex|former|old|past|previous)[\s-]+(.+)$/.exec(raw)
  if (m) return { type: byLabel.get(m[1].trim()), former: true }
  return { type: byLabel.get(raw), former: false }
}

/**
 * The old vocabulary had "ex" as a type of its own; it is a former
 * partner now. Returns the writes that retire it: every "ex" edge
 * becomes partner + former, and the built-in "ex" type goes once nothing
 * refers to it. Idempotent; no-op on a vault that never had it.
 */
export function migrateExToFormer(records: Map<string, DomainRecord>): {
  puts: DomainRecord[]
  deletes: string[]
} {
  let ex: RelationshipType | undefined
  let partner: RelationshipType | undefined
  for (const r of records.values()) {
    if (r.kind !== 'relationshipType' || !r.builtIn) continue
    if (r.label === 'ex') ex = r
    else if (r.label === 'partner') partner = r
  }
  if (!ex) return { puts: [], deletes: [] }
  const puts: DomainRecord[] = []
  let referenced = false
  for (const r of records.values()) {
    if (r.kind !== 'relationship' || r.typeId !== ex.id) continue
    if (!partner) {
      referenced = true
      continue
    }
    puts.push({ ...r, typeId: partner.id, directed: partner.directed, former: true })
  }
  return { puts, deletes: referenced ? [] : [ex.id] }
}
