/**
 * Biometric unlock via WebAuthn PRF (REQUIREMENTS.md §6.3 method 2).
 *
 * Enrollment creates a platform passkey with the PRF extension, evaluates
 * the PRF once, and wraps the raw DEK under an HKDF of the output. Unlock
 * re-evaluates the PRF (Face ID / fingerprint happens here) and unwraps.
 * The PRF output and raw DEK exist only transiently; the stored row holds
 * only wrapped material and carries no link to a vault slot.
 *
 * Availability varies (iOS 18+/recent Chrome, platform authenticator
 * required) — every caller must feature-detect and fall back cleanly to
 * the passphrase (§7).
 */
import { deriveKeyFromPrf, randomBytes, unwrapDek, wipe, wrapDek } from './crypto'
import { db, type AuthRow } from './db'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16))
}

export function webAuthnAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials
}

export async function biometricEnrollments(): Promise<AuthRow[]> {
  return db.auth.toArray()
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } }
}

function prfOutputOf(credential: PublicKeyCredential): Uint8Array | null {
  const ext = credential.getClientExtensionResults() as PrfResults
  const first = ext.prf?.results?.first
  if (!first) return null
  return first instanceof Uint8Array ? new Uint8Array(first) : new Uint8Array(first)
}

/**
 * Enroll: create the passkey, evaluate its PRF, wrap the raw DEK.
 * Returns false when the authenticator lacks PRF support (caller keeps
 * passphrase-only unlock). Throws on user cancel/other failures.
 */
export async function enrollBiometric(rawDek: Uint8Array): Promise<boolean> {
  const prfSalt = randomBytes(32)
  const userId = randomBytes(16)
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: 'Ledger' },
      user: { id: userId as BufferSource, name: 'ledger', displayName: 'Ledger' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!created) return false

  const credId = new Uint8Array(created.rawId)
  // Some authenticators return the PRF output at creation; others need a
  // follow-up assertion.
  let prfOutput = prfOutputOf(created)
  if (!prfOutput) {
    const asserted = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
    prfOutput = asserted ? prfOutputOf(asserted) : null
  }
  if (!prfOutput) return false

  const hkdfSalt = randomBytes(32)
  const kek = await deriveKeyFromPrf(prfOutput, hkdfSalt)
  wipe(prfOutput)
  const wrapped = await wrapDek(rawDek, kek)
  await db.auth.put({
    id: toHex(credId),
    prfSalt,
    hkdfSalt,
    wrappedDekIv: wrapped.iv,
    wrappedDek: wrapped.ciphertext,
    createdAt: Date.now(),
  })
  return true
}

/**
 * Authenticate and return the raw DEK bytes (caller passes them to
 * vault.unlockWithRawDek, which wipes them). Returns null when the
 * assertion fails or yields no PRF output.
 */
export async function biometricUnlock(): Promise<Uint8Array | null> {
  const rows = await db.auth.toArray()
  if (rows.length === 0) return null
  // All enrollments share one prompt; the responder's id picks the row.
  const asserted = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      allowCredentials: rows.map((r) => ({
        type: 'public-key' as const,
        id: fromHex(r.id) as BufferSource,
      })),
      userVerification: 'required',
      // A single eval salt only works when all rows share it; evaluate
      // per-credential via evalByCredential.
      extensions: {
        prf: {
          evalByCredential: Object.fromEntries(
            rows.map((r) => [
              bufferToBase64Url(fromHex(r.id)),
              { first: r.prfSalt as BufferSource },
            ]),
          ),
        },
      } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!asserted) return null
  const row = rows.find((r) => r.id === toHex(new Uint8Array(asserted.rawId)))
  if (!row) return null
  const prfOutput = prfOutputOf(asserted)
  if (!prfOutput) return null
  try {
    const kek = await deriveKeyFromPrf(prfOutput, row.hkdfSalt)
    return await unwrapDek({ iv: row.wrappedDekIv, ciphertext: row.wrappedDek }, kek)
  } finally {
    wipe(prfOutput)
  }
}

export async function removeBiometricEnrollments(): Promise<void> {
  await db.auth.clear()
}

function bufferToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
