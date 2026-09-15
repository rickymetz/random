/**
 * Roles on a link (§4.2): two people can be joined by several
 * relationships at once — coworker and former partner — each its own
 * record, each with an optional start, end and "former" flag. This
 * module holds the vocabulary around that: pair keys, labels, the batch
 * aliases ("ex", "former coworker"), and the one migration that turned
 * the old built-in "ex" type into "partner, former".
 */
import { formatPartialDate } from './dates'
import {
  BUILT_IN_RELATIONSHIP_TYPES,
  familyColor,
  type DomainRecord,
  type Relationship,
  type RelationshipType,
  type TypeFamily,
} from './models'

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

/** The family a type draws in; older custom types without one read as 'other'. */
export function familyOf(type: Pick<RelationshipType, 'family' | 'label'>): TypeFamily {
  return type.family ?? 'other'
}

export interface LineStyle {
  /** Screen px at zoom 1. */
  width: number
  /** Dash pattern in screen px, or none. */
  dash: number[] | null
  arrow: 'none' | 'filled' | 'open'
}

/** Custom types in one family take turns: solid, short dash, dot-dash. */
const VARIANTS: (number[] | null)[] = [null, [6, 3], [2, 3, 7, 3]]

/**
 * Shape inside the family carries the type: married thick, partner
 * medium, parent-of a filled arrow, boss-of an open chevron, roommate a
 * short dash; custom types cycle through dash variants in label order
 * within their family so two "work" types stay tellable apart.
 */
export function lineStyle(
  type: Pick<RelationshipType, 'id' | 'label' | 'directed' | 'builtIn' | 'family'>,
  siblings: readonly Pick<RelationshipType, 'id' | 'label' | 'builtIn' | 'family'>[] = [],
): LineStyle {
  if (type.builtIn) {
    switch (type.label) {
      case 'married':
        return { width: 3, dash: null, arrow: 'none' }
      case 'partner':
        return { width: 2.25, dash: null, arrow: 'none' }
      case 'parent of':
        return { width: 1.5, dash: null, arrow: 'filled' }
      case 'boss of':
        return { width: 1.5, dash: null, arrow: 'open' }
      case 'roommate':
        return { width: 1.25, dash: [6, 3], arrow: 'none' }
      case 'mentioned':
        return { width: 1.25, dash: [4, 4], arrow: 'none' }
      default:
        return { width: 1.25, dash: null, arrow: 'none' }
    }
  }
  const fam = familyOf(type)
  const peers = siblings
    .filter((t) => !t.builtIn && familyOf(t) === fam)
    .sort((a, b) => a.label.localeCompare(b.label))
  const index = Math.max(0, peers.findIndex((t) => t.id === type.id))
  return {
    width: 1.25,
    dash: VARIANTS[index % VARIANTS.length],
    arrow: type.directed ? 'open' : 'none',
  }
}

/**
 * Built-in types learn their family and family hue (once, on the way
 * in); a custom type without a family is filed under 'other' but keeps
 * the colour its owner chose. Returns the records to rewrite.
 */
export function assignTypeFamilies(records: Map<string, DomainRecord>): RelationshipType[] {
  const puts: RelationshipType[] = []
  const builtIn = new Map(BUILT_IN_RELATIONSHIP_TYPES.map((t) => [t.label, t]))
  for (const r of records.values()) {
    if (r.kind !== 'relationshipType') continue
    if (r.builtIn) {
      const spec = builtIn.get(r.label)
      if (!spec) continue
      if (r.family !== spec.family || r.color !== spec.color) {
        puts.push({ ...r, family: spec.family, color: spec.color })
      }
    } else if (!r.family) {
      puts.push({ ...r, family: 'other' })
    }
  }
  return puts
}

/** A new custom type's colour is its family's hue. */
export function colorForFamily(family: TypeFamily): string {
  return familyColor(family)
}
