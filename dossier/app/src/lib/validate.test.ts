import { describe, expect, it } from 'vitest'
import { sanitizeRecords } from './validate'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('sanitizer: unfinished notes in Settings', () => {
  it('keeps a draft per person, word for word, through every unlock', () => {
    const drafts = { [id(1)]: 'half a thought\n\nwith a blank line', [id(2)]: '  leading space kept' }
    const { records } = sanitizeRecords([{ kind: 'settings', id: 'settings', drafts }])
    expect(records[0]).toMatchObject({ kind: 'settings', drafts })
  })
  it('drops what is not a person id mapped to text', () => {
    const { records } = sanitizeRecords([
      {
        kind: 'settings',
        id: 'settings',
        drafts: { [id(1)]: 'ok', '../../etc': 'no', '__proto__ x': 'no', [id(2)]: 42, [id(3)]: '   ', [id(4)]: 'x'.repeat(50_001) },
      },
    ])
    expect((records[0] as { drafts?: Record<string, string> }).drafts).toEqual({ [id(1)]: 'ok' })
  })
  it('leaves no empty bag behind', () => {
    const { records } = sanitizeRecords([{ kind: 'settings', id: 'settings', drafts: ['nope'] }])
    expect((records[0] as { drafts?: unknown }).drafts).toBeUndefined()
  })
})
