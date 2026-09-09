/**
 * Crypto core for the vault (REQUIREMENTS.md §6.1–6.3).
 *
 * Envelope design: a random 256-bit DEK encrypts all records; the DEK is
 * persisted only wrapped by a KEK derived from the passphrase (and later,
 * additionally, by a WebAuthn-PRF-derived key). Changing the passphrase or
 * adding unlock methods re-wraps the DEK without re-encrypting data.
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

/** Derive the KEK from a passphrase. Used only to wrap/unwrap the DEK. */
export async function deriveKek(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
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
    ['wrapKey', 'unwrapKey'],
  )
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
    ['encrypt', 'decrypt'],
  )
}

/** Generate a fresh DEK. Non-extractable except through wrapKey. */
export async function generateDek(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<WrappedKey> {
  const iv = randomBytes(12)
  const ciphertext = await subtle.wrapKey('raw', dek, kek, {
    name: 'AES-GCM',
    iv: iv as BufferSource,
  })
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/**
 * Unwrap the DEK. Throws on a wrong passphrase (GCM authentication failure) —
 * callers trying multiple vault slots treat any failure as "not this slot"
 * (REQUIREMENTS.md §6.6).
 */
export async function unwrapDek(wrapped: WrappedKey, kek: CryptoKey): Promise<CryptoKey> {
  return subtle.unwrapKey(
    'raw',
    wrapped.ciphertext as BufferSource,
    kek,
    { name: 'AES-GCM', iv: wrapped.iv as BufferSource },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
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
