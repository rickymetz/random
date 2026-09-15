import { describe, expect, it } from 'vitest'
import { chipAction, toggleIsolate } from './chipIsolate'

const POOL = ['a', 'b', 'c']
const shown = (hidden: Set<string>, pool = POOL) => pool.filter((x) => !hidden.has(x))

describe('toggleIsolate', () => {
  it('first tap on a full rail leaves only that chip', () => {
    expect(shown(toggleIsolate(new Set(), POOL, 'b'))).toEqual(['b'])
  })

  it('tapping an off chip brings it back alongside', () => {
    const isolated = toggleIsolate(new Set(), POOL, 'b')
    expect(shown(toggleIsolate(isolated, POOL, 'c'))).toEqual(['b', 'c'])
  })

  it('tapping one of several shown chips hides just that one', () => {
    const two = new Set(['a'])
    expect(shown(toggleIsolate(two, POOL, 'b'))).toEqual(['c'])
  })

  it('tapping the last one standing restores everything', () => {
    const isolated = toggleIsolate(new Set(), POOL, 'b')
    expect(toggleIsolate(isolated, POOL, 'b').size).toBe(0)
  })

  it('never leaves the rail empty, whatever the sequence', () => {
    let hidden = new Set<string>()
    for (const id of ['a', 'b', 'c', 'a', 'c', 'b', 'b', 'a']) {
      hidden = toggleIsolate(hidden, POOL, id)
      expect(shown(hidden).length).toBeGreaterThan(0)
    }
  })

  it('a lone chip is inert rather than a way to empty the graph', () => {
    expect(shown(toggleIsolate(new Set(), ['a'], 'a'), ['a'])).toEqual(['a'])
  })

  it('a stale set that hides the whole pool recovers on the next tap', () => {
    // Sessions saved before isolation could persist "everything off".
    expect(shown(toggleIsolate(new Set(POOL), POOL, 'b'))).toEqual(['b'])
  })
})

describe('chipAction', () => {
  it('names what the tap will do', () => {
    expect(chipAction(new Set(), POOL, 'b', 'work')).toBe('Show only work')
    expect(chipAction(new Set(['a', 'c']), POOL, 'b', 'work')).toBe('Show all again')
    expect(chipAction(new Set(['a', 'c']), POOL, 'a', 'family')).toBe('Add family back')
    expect(chipAction(new Set(['a']), POOL, 'b', 'work')).toBe('Hide work')
  })
})
