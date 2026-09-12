import { describe, expect, it } from 'vitest'
import { parseBatch } from './batch'
import type { Person, RelationshipType } from './models'

const t = (label: string, directed = false): RelationshipType => ({
  kind: 'relationshipType',
  id: `t-${label}`,
  label,
  color: '#000',
  directed,
  builtIn: true,
})
const p = (displayName: string): Person => ({
  kind: 'person',
  id: `p-${displayName}`,
  displayName,
  nicknames: [],
  likes: [],
  dislikes: [],
  tags: [],
  createdAt: 0,
  updatedAt: 0,
})
const types = [t('friend'), t('coworker'), t('boss of', true)]

describe('parseBatch', () => {
  it('reads one name per line with an optional relationship after a dash', () => {
    const out = parseBatch('Sam Okafor — coworker\nPriya Raman - Boss Of\nTheo\n', types, [])
    expect(out.map((e) => [e.name, e.typeLabel, e.type?.label])).toEqual([
      ['Sam Okafor', 'coworker', 'coworker'],
      ['Priya Raman', 'Boss Of', 'boss of'],
      ['Theo', undefined, undefined],
    ])
  })
  it('splits comma lists, skips blanks, collapses duplicates, strips a leading @', () => {
    const out = parseBatch('Sam, priya , Theo\n\n@Sam\nSAM', types, [])
    expect(out.map((e) => e.name)).toEqual(['Sam', 'priya', 'Theo'])
  })
  it('keeps an unknown relationship label so the UI can say so', () => {
    const [e] = parseBatch('Sam — landlord', types, [])
    expect(e.typeLabel).toBe('landlord')
    expect(e.type).toBeUndefined()
  })
  it('flags people who already exist by name', () => {
    const out = parseBatch('sam okafor — friend\nNew Person', types, [p('Sam Okafor')])
    expect(out[0].existing?.displayName).toBe('Sam Okafor')
    expect(out[1].existing).toBeUndefined()
  })
  it('does not treat a hyphenated name as a separator', () => {
    const [e] = parseBatch('Mary-Anne Lopes', types, [])
    expect(e.name).toBe('Mary-Anne Lopes')
    expect(e.typeLabel).toBeUndefined()
  })
})

describe('parseBatch edge cases', () => {
  it('drops a trailing separator instead of keeping it in the name', () => {
    expect(parseBatch('Sam —\nPriya -\nTheo:', types, []).map((e) => e.name)).toEqual([
      'Sam',
      'Priya',
      'Theo',
    ])
  })
  it('applies a line type to every comma-separated name before it', () => {
    const out = parseBatch('Sam, Priya — coworker', types, [])
    expect(out.map((e) => [e.name, e.type?.label])).toEqual([
      ['Sam', 'coworker'],
      ['Priya', 'coworker'],
    ])
  })
  it('never splits on dashes when there is nothing to link to', () => {
    const [e] = parseBatch('Jean - Luc', types, [], false)
    expect(e.name).toBe('Jean - Luc')
    expect(e.typeLabel).toBeUndefined()
  })
})
