import { describe, expect, it } from 'vitest'
import {
  decryptJson,
  deriveKek,
  encryptJson,
  generateDekBytes,
  importDek,
  randomBytes,
  unwrapDek,
  validateKdfParams,
  wrapDek,
  type KdfParams,
} from './crypto'

// Low iteration count keeps tests fast; production uses DEFAULT_KDF_PARAMS.
const TEST_KDF: KdfParams = { algorithm: 'PBKDF2-SHA-256', iterations: 1000 }

describe('key envelope', () => {
  it('round-trips the DEK through wrap/unwrap', async () => {
    const salt = randomBytes(16)
    const kek = await deriveKek('correct horse', salt, TEST_KDF)
    const rawDek = generateDekBytes()
    const dek = await importDek(rawDek)
    const wrapped = await wrapDek(rawDek, kek)

    const unwrappedRaw = await unwrapDek(wrapped, kek)
    const unwrapped = await importDek(unwrappedRaw)
    const ct = await encryptJson(unwrapped, { hello: 'world' })
    expect(await decryptJson(dek, ct)).toEqual({ hello: 'world' })
  })

  it('imports the DEK as non-extractable', async () => {
    const dek = await importDek(generateDekBytes())
    expect(dek.extractable).toBe(false)
    await expect(globalThis.crypto.subtle.exportKey('raw', dek)).rejects.toThrow()
  })

  it('rejects the wrong passphrase', async () => {
    const salt = randomBytes(16)
    const kek = await deriveKek('right', salt, TEST_KDF)
    const rawDek = generateDekBytes()
    const wrapped = await wrapDek(rawDek, kek)

    const wrongKek = await deriveKek('wrong', salt, TEST_KDF)
    await expect(unwrapDek(wrapped, wrongKek)).rejects.toThrow()
  })

  it('re-wrapping for a new passphrase keeps the data readable', async () => {
    const rawDek = generateDekBytes()
    const dek = await importDek(rawDek)
    const ct = await encryptJson(dek, { name: 'Ada' })

    const newKek = await deriveKek('new passphrase', randomBytes(16), TEST_KDF)
    const rewrapped = await wrapDek(rawDek, newKek)
    const dekAgain = await importDek(await unwrapDek(rewrapped, newKek))
    expect(await decryptJson(dekAgain, ct)).toEqual({ name: 'Ada' })
  })

  it('never repeats an IV', async () => {
    const dek = await importDek(generateDekBytes())
    const a = await encryptJson(dek, 1)
    const b = await encryptJson(dek, 1)
    expect([...a.iv]).not.toEqual([...b.iv])
    expect([...a.blob]).not.toEqual([...b.blob])
  })
})

describe('kdf parameter validation', () => {
  it('accepts sane params and rejects hostile ones', () => {
    expect(validateKdfParams({ algorithm: 'PBKDF2-SHA-256', iterations: 600_000 })).toEqual({
      algorithm: 'PBKDF2-SHA-256',
      iterations: 600_000,
    })
    // A crafted 2-billion-iteration header must not hang the device.
    expect(() =>
      validateKdfParams({ algorithm: 'PBKDF2-SHA-256', iterations: 2_000_000_000 }),
    ).toThrow()
    expect(() => validateKdfParams({ algorithm: 'PBKDF2-SHA-256', iterations: 0 })).toThrow()
    expect(() => validateKdfParams({ algorithm: 'MD5', iterations: 600_000 })).toThrow()
    expect(() => validateKdfParams(undefined)).toThrow()
  })
})
