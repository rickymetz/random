import { describe, expect, it } from 'vitest'
import {
  decryptJson,
  deriveKek,
  encryptJson,
  generateDek,
  randomBytes,
  unwrapDek,
  wrapDek,
  type KdfParams,
} from './crypto'

// Low iteration count keeps tests fast; production uses DEFAULT_KDF_PARAMS.
const TEST_KDF: KdfParams = { algorithm: 'PBKDF2-SHA-256', iterations: 1000 }

describe('key envelope', () => {
  it('round-trips the DEK through wrap/unwrap', async () => {
    const salt = randomBytes(16)
    const kek = await deriveKek('correct horse', salt, TEST_KDF)
    const dek = await generateDek()
    const wrapped = await wrapDek(dek, kek)

    const unwrapped = await unwrapDek(wrapped, kek)
    const ct = await encryptJson(unwrapped, { hello: 'world' })
    expect(await decryptJson(dek, ct)).toEqual({ hello: 'world' })
  })

  it('rejects the wrong passphrase', async () => {
    const salt = randomBytes(16)
    const kek = await deriveKek('right', salt, TEST_KDF)
    const dek = await generateDek()
    const wrapped = await wrapDek(dek, kek)

    const wrongKek = await deriveKek('wrong', salt, TEST_KDF)
    await expect(unwrapDek(wrapped, wrongKek)).rejects.toThrow()
  })

  it('re-wrapping for a new passphrase keeps the data readable', async () => {
    const dek = await generateDek()
    const ct = await encryptJson(dek, { name: 'Ada' })

    const newKek = await deriveKek('new passphrase', randomBytes(16), TEST_KDF)
    const rewrapped = await wrapDek(dek, newKek)
    const dekAgain = await unwrapDek(rewrapped, newKek)
    expect(await decryptJson(dekAgain, ct)).toEqual({ name: 'Ada' })
  })

  it('never repeats an IV', async () => {
    const dek = await generateDek()
    const a = await encryptJson(dek, 1)
    const b = await encryptJson(dek, 1)
    expect([...a.iv]).not.toEqual([...b.iv])
    expect([...a.blob]).not.toEqual([...b.blob])
  })
})
