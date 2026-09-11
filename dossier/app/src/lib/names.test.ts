import { describe, expect, it } from 'vitest'
import { RAIL_LETTERS, letterOf, rankPeople, rowsToReveal, shortName } from './names'

describe('letterOf', () => {
  it('folds accents to the base letter so headers match the collator order', () => {
    expect(letterOf('Émile')).toBe('E')
    expect(letterOf('Émile')).toBe('E') // NFD form
    expect(letterOf('Ådne')).toBe('A')
    expect(letterOf('Şule')).toBe('S')
    expect(letterOf('émile')).toBe('E')
  })
  it('files digits, symbols, other scripts and empty names under #', () => {
    expect(letterOf('3M rep')).toBe('#')
    expect(letterOf('🎉 Party Pete')).toBe('#')
    expect(letterOf('Иван')).toBe('#')
    expect(letterOf('ßeta')).toBe('#')
    expect(letterOf('')).toBe('#')
    expect(letterOf('   ')).toBe('#')
  })
  it('only ever returns a rail letter', () => {
    for (const n of ['Ada', 'zed', 'Émile', '3M', '', 'Иван', 'ßeta']) {
      expect(RAIL_LETTERS).toContain(letterOf(n))
    }
    expect(RAIL_LETTERS[0]).toBe('#')
  })
})

describe('shortName', () => {
  it('keeps the first name and the last initial', () => {
    expect(shortName('Ada Kowalski')).toBe('Ada K.')
    expect(shortName('Ada Lovelace Jr.')).toBe('Ada J.')
    expect(shortName('  Ada  ')).toBe('Ada')
    expect(shortName('Ada 🎉')).toBe('Ada 🎉.')
    expect(shortName('')).toBe('')
  })
})

describe('rowsToReveal', () => {
  it('rounds up to a page boundary', () => {
    expect(rowsToReveal(0, 60)).toBe(60)
    expect(rowsToReveal(59, 60)).toBe(60)
    expect(rowsToReveal(60, 60)).toBe(120)
    expect(rowsToReveal(299, 60)).toBe(300)
  })
})

describe('rankPeople', () => {
  const p = (displayName: string, nicknames: string[] = []) => ({ displayName, nicknames })
  const people = [p('Marcus Webb'), p('Priya Raman', ['Pri']), p('Sam Kim'), p('Amara Okafor'), p('Elena Sofia')]
  it('prefers whole-name prefix, then word prefix, then substring', () => {
    expect(rankPeople(people, 'ma', 10).map((x) => x.displayName)).toEqual([
      'Marcus Webb', // whole-name prefix
      'Amara Okafor', // word prefix
      'Priya Raman', // substring (ra-ma-n)
    ])
    expect(rankPeople(people, 'kim', 10).map((x) => x.displayName)).toEqual(['Sam Kim'])
    expect(rankPeople(people, 'pri', 10).map((x) => x.displayName)).toEqual(['Priya Raman'])
    expect(rankPeople(people, 'zzz', 10)).toEqual([])
  })
  it('lists everyone alphabetically for an empty query, capped', () => {
    expect(rankPeople(people, '', 3).map((x) => x.displayName)).toEqual([
      'Amara Okafor',
      'Elena Sofia',
      'Marcus Webb',
    ])
  })
})
