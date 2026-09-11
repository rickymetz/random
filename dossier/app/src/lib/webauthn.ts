/**
 * Biometric unlock via WebAuthn PRF (REQUIREMENTS.md §6.3 method 2).
 *
 * Enrollment creates a platform passkey with the PRF extension, evaluates
 * the PRF once, and wraps the raw DEK under an HKDF of the output. Unlock
 * re-evaluates the PRF (Face ID / fingerprint happens here) and unwraps.
 * The PRF output and raw DEK exist only transiently; the stored row holds
 * only wrapped material and carries no link to a vault slot and no
 * timestamps.
 *
 * Documented residuals: that enrollments exist (and how many) is
 * observable in the raw database, and the passkey itself lives in the OS
 * credential store under this origin — the OS-side entry is outside our
 * control and survives destroyAllData(); the Settings UI says so. The
 * rp/user name is the app's neutral disguise name (§6.5).
 *
 * Availability varies (iOS 18+/recent Chrome, platform authenticator
 * required) — every caller must feature-detect and fall back cleanly to
 * the passphrase (§7). User cancellation throws (NotAllowedError);
 * callers must not report it as "unsupported".
 */
import { deriveKeyFromPrf, randomBytes, unwrapDek, wipe, wrapDek } from './crypto'
import { db, type AuthRow } from './db'
import { currentDisguise } from './disguise'

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
  return first ? new Uint8Array(first as ArrayBuffer) : null
}

export type EnrollResult =
  | { status: 'ok'; credentialId: string }
  | { status: 'unsupported' }

/**
 * Enroll: create the passkey, evaluate its PRF, wrap the raw DEK.
 * 'unsupported' when the authenticator lacks PRF; throws on user cancel
 * (NotAllowedError) and other failures. NOTE: when creation succeeds but
 * PRF is unsupported, the OS-side passkey cannot be deleted from JS — an
 * orphan remains in the system credential manager (surfaced in the UI).
 */
export async function enrollBiometric(rawDek: Uint8Array): Promise<EnrollResult> {
  const prfSalt = randomBytes(32)
  const userId = randomBytes(16)
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      // Passkey names match the installed disguise (§6.5) — the system
      // credential list should read like the icon on the home screen.
      rp: { name: currentDisguise().name },
      user: {
        id: userId as BufferSource,
        name: currentDisguise().name.toLowerCase(),
        displayName: currentDisguise().name,
      },
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
  if (!created) return { status: 'unsupported' }

  const credId = new Uint8Array(created.rawId)
  const creationExt = created.getClientExtensionResults() as PrfResults
  // An explicit "PRF not enabled" means a follow-up assertion cannot help;
  // don't burn a second Face ID prompt on a lost cause.
  if (creationExt.prf && creationExt.prf.enabled === false) return { status: 'unsupported' }

  const response = created.response as AuthenticatorAttestationResponse
  const transports =
    typeof response.getTransports === 'function' ? response.getTransports() : []

  // Some authenticators return the PRF output at creation; others need a
  // follow-up assertion.
  let prfOutput = prfOutputOf(created)
  if (!prfOutput) {
    const asserted = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        allowCredentials: [
          {
            type: 'public-key',
            id: credId as BufferSource,
            transports: transports as AuthenticatorTransport[],
          },
        ],
        userVerification: 'required',
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
    prfOutput = asserted ? prfOutputOf(asserted) : null
  }
  if (!prfOutput) return { status: 'unsupported' }

  const hkdfSalt = randomBytes(32)
  const kek = await deriveKeyFromPrf(prfOutput, hkdfSalt)
  wipe(prfOutput)
  const wrapped = await wrapDek(rawDek, kek)
  const credentialId = toHex(credId)
  await db.auth.put({
    id: credentialId,
    prfSalt,
    hkdfSalt,
    wrappedDekIv: wrapped.iv,
    wrappedDek: wrapped.ciphertext,
    transports,
  })
  return { status: 'ok', credentialId }
}

export async function removeBiometricEnrollment(credentialId: string): Promise<void> {
  await db.auth.delete(credentialId)
}

/**
 * Authenticate and return the raw DEK bytes (caller passes them to
 * vault.unlockWithRawDek, which wipes them). Returns null when the
 * assertion yields no PRF output; throws on user cancel.
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
        transports: (r.transports ?? []) as AuthenticatorTransport[],
      })),
      userVerification: 'required',
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

/** True when the thrown error is the user dismissing the platform sheet. */
export function isUserCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

function bufferToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
