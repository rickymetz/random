import { describe, expect, it } from 'vitest'
import { distanceToHull, rimAnchors } from './hullLabel'

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

describe('distanceToHull', () => {
  it('is zero inside, and the gap to the nearest edge outside', () => {
    expect(distanceToHull({ x: 50, y: 50 }, square)).toBe(0)
    expect(distanceToHull({ x: 50, y: -20 }, square)).toBeCloseTo(20)
    expect(distanceToHull({ x: 130, y: 140 }, square)).toBeCloseTo(50)
  })
  it('handles the one- and two-member circles a hull degenerates to', () => {
    expect(distanceToHull({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBeCloseTo(5)
    expect(distanceToHull({ x: 50, y: 10 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBeCloseTo(10)
  })
})

describe('rimAnchors', () => {
  it('only offers points on the bubble’s own rim', () => {
    const anchors = rimAnchors(square, 34, 4)
    expect(anchors.length).toBeGreaterThan(8)
    for (const a of anchors) expect(distanceToHull(a, square)).toBeCloseTo(38, 0)
  })
  it('tries the top of the bubble before its sides, and its sides before below', () => {
    const anchors = rimAnchors(square, 34, 4)
    const bands = anchors.map((a) => (a.uy <= -0.6 ? 0 : a.uy >= 0.6 ? 2 : 1))
    expect(bands).toEqual([...bands].sort((a, b) => a - b))
    expect(anchors[0].y).toBeLessThan(0)
  })
  it('rings a single member all the way round', () => {
    const anchors = rimAnchors([{ x: 0, y: 0 }], 34, 4, 16)
    expect(anchors).toHaveLength(16)
  })
})
