/**
 * Crypto core for the vault (REQUIREMENTS.md §6.1–6.3).
 *
 * Envelope design: a random 256-bit DEK encrypts all records; the DEK is
 * persisted only wrapped by a KEK derived from the passphrase (and later,
 * additionally, by a WebAuthn-PRF-derived key). Changing the passphrase or
 * adding unlock methods re-wraps the DEK without re-encrypting data.
 *
 * The DEK is handled as raw bytes only transiently (generate → wrap →
 * import), and the CryptoKey the app holds is always non-extractable, so
 * a debugger on an unlocked session cannot exportKey() the vault's root.
 *
 * KDF is PBKDF2-SHA-256 for the scaffold; Argon2id (WASM) replaces it in
 * v1.x. Parameters are recorded per vault slot so they can be migrated.
 */

const subtle = globalThis.crypto.subtle

export interface KdfParams {
  algorithm: 'PBKDF2-SHA-256'
  iterations: number
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'PBKDF2-SHA-256',
  iterations: 600_000,
}

/** Bounds accepted from untrusted sources (import headers, stored slots). */
export const KDF_ITERATION_BOUNDS = { min: 100_000, max: 5_000_000 }

export function validateKdfParams(params: unknown): KdfParams {
  const p = params as Partial<KdfParams> | null
  if (
    !p ||
    p.algorithm !== 'PBKDF2-SHA-256' ||
    typeof p.iterations !== 'number' ||
    !Number.isInteger(p.iterations) ||
    p.iterations < KDF_ITERATION_BOUNDS.min ||
    p.iterations > KDF_ITERATION_BOUNDS.max
  ) {
    throw new Error('Unsupported key-derivation parameters.')
  }
  return { algorithm: p.algorithm, iterations: p.iterations }
}

export interface WrappedKey {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export interface Ciphertext {
  iv: Uint8Array
  blob: Uint8Array
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

async function derivePassphraseKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: params.iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

/** Derive the KEK from a passphrase. Used only to wrap/unwrap the DEK. */
export async function deriveKek(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<CryptoKey> {
  return derivePassphraseKey(passphrase, salt, params, ['encrypt', 'decrypt'])
}

/**
 * Derive a direct encryption key from a passphrase. Used for export
 * bundles (§4.5), which must be openable with the passphrase alone —
 * independent of any vault slot on the exporting device.
 */
export async function deriveExportKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<CryptoKey> {
  return derivePassphraseKey(passphrase, salt, params, ['encrypt', 'decrypt'])
}

/**
 * Turn a WebAuthn PRF output into a KEK for wrapping the DEK (§6.2,
 * biometric unlock). HKDF-SHA-256 with a stored random salt; the PRF
 * output itself never persists.
 */
export async function deriveKeyFromPrf(
  prfOutput: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await subtle.importKey('raw', prfOutput as BufferSource, 'HKDF', false, [
    'deriveKey',
  ])
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode('dossier-biometric-kek-v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * PIN session key (§6.3). Deliberately lighter than the passphrase KDF:
 * the PIN wrap lives only in memory with a 5-attempt limit — it is never
 * persisted, so offline brute force gets nothing to attack.
 */
export const PIN_KDF_PARAMS: KdfParams = { algorithm: 'PBKDF2-SHA-256', iterations: 100_000 }

export async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  return derivePassphraseKey(pin, salt, PIN_KDF_PARAMS, ['encrypt', 'decrypt'])
}

/** Fresh raw DEK bytes. Callers must wipe() after wrapping + importing. */
export function generateDekBytes(): Uint8Array {
  return randomBytes(32)
}

/** Import raw DEK bytes as a NON-extractable working key. */
export async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Best-effort zeroization of transient key material. */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0)
}

/**
 * Wrap raw DEK bytes under the KEK. AES-GCM over the raw key bytes —
 * byte-compatible with SubtleCrypto wrapKey('raw', …, AES-GCM).
 */
export async function wrapDek(rawDek: Uint8Array, kek: CryptoKey): Promise<WrappedKey> {
  const iv = randomBytes(12)
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    kek,
    rawDek as BufferSource,
  )
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/**
 * Unwrap to raw DEK bytes. Throws on a wrong passphrase (GCM auth
 * failure) — callers trying multiple vault slots treat any failure as
 * "not this slot" (REQUIREMENTS.md §6.6). Callers must wipe() the result
 * after importDek().
 */
export async function unwrapDek(wrapped: WrappedKey, kek: CryptoKey): Promise<Uint8Array> {
  const raw = await subtle.decrypt(
    { name: 'AES-GCM', iv: wrapped.iv as BufferSource },
    kek,
    wrapped.ciphertext as BufferSource,
  )
  return new Uint8Array(raw)
}

/** Encrypt one record payload (already serialized) under the DEK. */
export async function encryptBlob(dek: CryptoKey, plaintext: Uint8Array): Promise<Ciphertext> {
  const iv = randomBytes(12)
  const blob = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    dek,
    plaintext as BufferSource,
  )
  return { iv, blob: new Uint8Array(blob) }
}

export async function decryptBlob(dek: CryptoKey, ciphertext: Ciphertext): Promise<Uint8Array> {
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: ciphertext.iv as BufferSource },
    dek,
    ciphertext.blob as BufferSource,
  )
  return new Uint8Array(plaintext)
}

export async function encryptJson(dek: CryptoKey, value: unknown): Promise<Ciphertext> {
  return encryptBlob(dek, new TextEncoder().encode(JSON.stringify(value)))
}

export async function decryptJson<T>(dek: CryptoKey, ciphertext: Ciphertext): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await decryptBlob(dek, ciphertext))) as T
}
