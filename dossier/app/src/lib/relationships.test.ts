import { describe, expect, it } from 'vitest'
import type { DomainRecord, Relationship, RelationshipType } from './models'
import {
  assignTypeFamilies,
  familyOf,
  lineStyle,
  migrateExToFormer,
  pairKey,
  parseRoleLabel,
  roleDates,
  roleLabel,
} from './relationships'

const t = (label: string, builtIn = true): RelationshipType => ({
  kind: 'relationshipType',
  id: `t-${label}`,
  label,
  color: '#000',
  directed: false,
  builtIn,
})
const rel = (typeId: string, extra: Partial<Relationship> = {}): Relationship => ({
  kind: 'relationship',
  id: `r-${typeId}-${Math.random()}`,
  fromId: 'a',
  toId: 'b',
  typeId,
  directed: false,
  origin: 'explicit',
  createdAt: 0,
  ...extra,
})

describe('relationship roles', () => {
  it('pairKey is order-independent', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
  })

  it('labels a former role and its dates the way people say them', () => {
    expect(roleLabel('partner', { former: true })).toBe('former partner')
    expect(roleLabel('partner', {})).toBe('partner')
    expect(roleDates({ startDate: { year: 2019 }, endDate: { year: 2021 } })).toBe('2019–2021')
    expect(roleDates({ startDate: { year: 2019 } })).toBe('since 2019')
    expect(roleDates({ endDate: { year: 2021 } })).toBe('until 2021')
    expect(roleDates({})).toBe('')
  })

  it('parses ex / former / ex- aliases', () => {
    const types = [t('partner'), t('coworker'), t('boss of')]
    expect(parseRoleLabel('ex', types)).toEqual({ type: types[0], former: true })
    expect(parseRoleLabel('Ex-Partner', types)).toEqual({ type: types[0], former: true })
    expect(parseRoleLabel('former coworker', types)).toEqual({ type: types[1], former: true })
    expect(parseRoleLabel('old boss of', types)).toEqual({ type: types[2], former: true })
    expect(parseRoleLabel('coworker', types)).toEqual({ type: types[1], former: false })
    expect(parseRoleLabel('neighbour', types)).toEqual({ type: undefined, former: false })
  })

  it('retires the old built-in ex type into partner + former', () => {
    const ex = t('ex')
    const partner = t('partner')
    const old = rel(ex.id)
    const keep = rel(partner.id)
    const records = new Map<string, DomainRecord>([ex, partner, old, keep].map((r) => [r.id, r]))
    const { puts, deletes } = migrateExToFormer(records)
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({ id: old.id, typeId: partner.id, former: true })
    expect(deletes).toEqual([ex.id])
    // Nothing to do on a vault that never had it.
    expect(migrateExToFormer(new Map([[partner.id, partner]]))).toEqual({ puts: [], deletes: [] })
  })

  it('shape carries the type inside a hue family', () => {
    const married = { ...t('married'), family: 'family' as const }
    const partner = { ...t('partner'), family: 'family' as const }
    const parent = { ...t('parent of'), directed: true, family: 'family' as const }
    const boss = { ...t('boss of'), directed: true, family: 'work' as const }
    const roommate = { ...t('roommate'), family: 'social' as const }
    expect(lineStyle(married).width).toBeGreaterThan(lineStyle(partner).width)
    expect(lineStyle(parent).arrow).toBe('filled')
    expect(lineStyle(boss).arrow).toBe('open')
    expect(lineStyle(roommate).dash).toEqual([6, 3])
    // Custom types in one family take turns: solid, short dash, dot-dash.
    const a = { ...t('mentor', false), family: 'work' as const }
    const b = { ...t('client', false), family: 'work' as const }
    const c = { ...t('vendor', false), family: 'work' as const }
    const all = [a, b, c, boss]
    expect(lineStyle(b, all).dash).toBeNull() // "client" sorts first
    expect(lineStyle(a, all).dash).toEqual([6, 3])
    expect(lineStyle(c, all).dash).toEqual([2, 3, 7, 3])
    expect(familyOf(t('legacy', false))).toBe('other')
  })

  it('files built-in types under their family and hue, keeps custom colours', () => {
    const friend = { ...t('friend'), color: '#000000' }
    const custom = { ...t('mentor', false), color: '#123456' }
    const records = new Map<string, DomainRecord>([friend, custom].map((r) => [r.id, r]))
    const puts = assignTypeFamilies(records)
    expect(puts).toHaveLength(2)
    expect(puts.find((r) => r.id === friend.id)).toMatchObject({ family: 'social', color: '#4f9cf9' })
    expect(puts.find((r) => r.id === custom.id)).toMatchObject({ family: 'other', color: '#123456' })
    // Idempotent.
    for (const r of puts) records.set(r.id, r)
    expect(assignTypeFamilies(records)).toHaveLength(0)
  })
})
