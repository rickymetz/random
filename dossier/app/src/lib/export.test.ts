import { describe, expect, it } from 'vitest'
import { exportBundle, importBundle } from './export'
import type { Person } from './models'

function makePerson(name: string): Person {
  return {
    kind: 'person',
    id: crypto.randomUUID(),
    displayName: name,
    nicknames: [],
    likes: ['sailing'],
    dislikes: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('encrypted export', () => {
  it('round-trips records through export/import', async () => {
    const records = [makePerson('Ada'), makePerson('Grace')]
    const bundle = await exportBundle('open sesame', records)
    const restored = await importBundle('open sesame', bundle)
    expect(restored).toEqual(records)
  })

  it('returns null for a wrong passphrase', async () => {
    const bundle = await exportBundle('right', [makePerson('Ada')])
    expect(await importBundle('wrong', bundle)).toBeNull()
  })

  it('never contains plaintext', async () => {
    const bundle = await exportBundle('open sesame', [makePerson('Ada Lovelace')])
    expect(bundle).not.toContain('Lovelace')
    expect(bundle).not.toContain('sailing')
    expect(bundle).not.toContain('person')
  })

  it('rejects a non-backup file with a message', async () => {
    await expect(importBundle('x', 'not json')).rejects.toThrow('Not a backup file.')
    await expect(importBundle('x', '{"format":"other"}')).rejects.toThrow('Not a backup file.')
  })

  it('rejects hostile KDF params in the header instead of hanging', async () => {
    const bundle = JSON.parse(await exportBundle('pw', [makePerson('Ada')]))
    bundle.kdf = { algorithm: 'PBKDF2-SHA-256', iterations: 2_000_000_000 }
    await expect(importBundle('pw', JSON.stringify(bundle))).rejects.toThrow(
      'Not a backup file.',
    )
    bundle.kdf = { algorithm: 'PBKDF2-SHA-256', iterations: 0 }
    await expect(importBundle('pw', JSON.stringify(bundle))).rejects.toThrow(
      'Not a backup file.',
    )
  })
}, 30_000)
