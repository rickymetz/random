import { describe, expect, it } from 'vitest'
import { extractMentions, mentionToken, plainText, segmentBody } from './mentions'

const ada = { id: '11111111-1111-1111-1111-111111111111', displayName: 'Ada Lovelace' }
const bob = { id: '22222222-2222-2222-2222-222222222222', displayName: 'Bob [B] (Bobby)' }

describe('mentions', () => {
  it('round-trips a token through extraction', () => {
    const body = `Met ${mentionToken(ada)} at the climbing gym`
    expect(extractMentions(body)).toEqual([ada.id])
  })

  it('strips token-breaking characters from names', () => {
    const body = mentionToken(bob)
    expect(extractMentions(body)).toEqual([bob.id])
    expect(segmentBody(body)).toEqual([
      { type: 'mention', name: 'Bob B Bobby', personId: bob.id },
    ])
  })

  it('dedupes repeated mentions', () => {
    const body = `${mentionToken(ada)} and ${mentionToken(ada)} again`
    expect(extractMentions(body)).toEqual([ada.id])
  })

  it('segments text around mentions', () => {
    const body = `Dinner with ${mentionToken(ada)} tomorrow`
    const segments = segmentBody(body)
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ type: 'text', text: 'Dinner with ' })
    expect(segments[1]).toMatchObject({ type: 'mention', personId: ada.id })
    expect(segments[2]).toEqual({ type: 'text', text: ' tomorrow' })
  })

  it('flattens tokens for search indexing', () => {
    expect(plainText(`Ask ${mentionToken(ada)} about it`)).toBe('Ask @Ada Lovelace about it')
  })

  it('ignores things that look almost like tokens', () => {
    expect(extractMentions('email me @[not-a-token](nope) ok')).toEqual([])
  })
})

describe('renameMentionsOf', () => {
  it('rewrites only the tokens for the renamed id', async () => {
    const { renameMentionsOf, mentionToken } = await import('./mentions')
    const a = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Ann Old' }
    const b = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Ben' }
    const body = `x ${mentionToken(a)} y ${mentionToken(b)} z`
    const out = renameMentionsOf(body, a.id, 'Ann New')
    expect(out).toBe(`x ${mentionToken({ ...a, displayName: 'Ann New' })} y ${mentionToken(b)} z`)
  })
})
