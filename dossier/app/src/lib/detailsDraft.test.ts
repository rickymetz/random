import { describe, expect, it } from 'vitest'
import { applyDetailsDraft, encodeDetailsDraft } from './detailsDraft'

const base = {
  form: { displayName: 'Ada', location: '', tags: ['sailing'] },
  custom: { f1: '', f2: [] as string[], f3: 0 },
  isSelf: false,
}
const types = { f1: 'text', f2: 'chips', f3: 'number' } as const

describe('the Edit form’s kept draft', () => {
  it('keeps only what changed, and nothing when nothing did', () => {
    expect(encodeDetailsDraft(base, { ...base, chips: {} })).toBe('')
    expect(encodeDetailsDraft(base, { ...base, chips: { tags: '  ' } })).toBe('')
    const text = encodeDetailsDraft(base, {
      form: { ...base.form, location: 'Lisbon' },
      custom: { ...base.custom, f2: ['blue'] },
      chips: { tags: 'regat' },
      isSelf: false,
    })
    expect(JSON.parse(text)).toEqual({ form: { location: 'Lisbon' }, custom: { f2: ['blue'] }, chips: { tags: 'regat' } })
  })

  it('lays the changes over what the person has now', () => {
    const text = encodeDetailsDraft(base, { ...base, form: { ...base.form, location: 'Lisbon' }, chips: {} })
    // Renamed since the draft was kept: the rename stands.
    const now = { ...base, form: { ...base.form, displayName: 'Ada L.' } }
    expect(applyDetailsDraft(text, now, types)?.form).toEqual({ displayName: 'Ada L.', location: 'Lisbon', tags: ['sailing'] })
  })

  it('drops what no longer fits, and anything unreadable', () => {
    const text = JSON.stringify({
      form: { location: 5, tags: 'not a list', nope: 'x', displayName: 'Ada B' },
      custom: { f1: ['wrong'], f3: 'NaN', gone: 'x', f2: ['ok'] },
      chips: { location: 'not a list field', tags: 'sail' },
      isSelf: 'yes',
    })
    expect(applyDetailsDraft(text, base, types)).toEqual({
      form: { ...base.form, displayName: 'Ada B' },
      custom: { ...base.custom, f2: ['ok'] },
      chips: { tags: 'sail' },
      isSelf: false,
    })
    expect(applyDetailsDraft('{oops', base, types)).toBeUndefined()
    expect(applyDetailsDraft('[]', base, types)).toBeUndefined()
    expect(applyDetailsDraft(JSON.stringify({ form: { nope: 'x' } }), base, types)).toBeUndefined()
    expect(applyDetailsDraft(undefined, base, types)).toBeUndefined()
  })
})
