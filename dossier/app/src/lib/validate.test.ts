import { describe, expect, it } from 'vitest'
import { sanitizeRecords } from './validate'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('sanitizer: notes being written', () => {
  it('keeps a draft word for word, blank lines and leading space too', () => {
    const draft = { kind: 'draft', id: id(9), personId: id(1), body: '  half a thought\n\nwith a gap', updatedAt: 5 }
    const { records } = sanitizeRecords([draft])
    expect(records).toEqual([draft])
  })
  it('drops what is not a person id with text', () => {
    const bad = [
      { kind: 'draft', id: id(9), personId: '../../etc', body: 'x', updatedAt: 1 },
      { kind: 'draft', id: id(8), personId: id(1), body: 42, updatedAt: 1 },
      { kind: 'draft', id: id(7), personId: id(1), body: '   ', updatedAt: 1 },
      { kind: 'draft', id: id(6), personId: id(1), body: 'x'.repeat(50_001), updatedAt: 1 },
    ]
    expect(sanitizeRecords(bad).records).toEqual([])
  })
})
