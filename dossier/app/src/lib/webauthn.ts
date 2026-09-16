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

/** The half of the PRF extension inputs we send at assertion time. */
type AuthenticationExtensionsPRFInputs =
  | { eval: { first: BufferSource } }
  | { evalByCredential: Record<string, { first: BufferSource }> }

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
/**
 * Safari 17.4+ can say up front whether the PRF extension exists
 * (iOS 18+). Where it says no, skip creation entirely — a passkey
 * minted first and found useless afterwards stays in the system
 * credential list as an orphan.
 */
async function prfKnownUnsupported(): Promise<boolean> {
  const PKC = PublicKeyCredential as unknown as {
    getClientCapabilities?: () => Promise<Record<string, boolean>>
  }
  if (typeof PKC.getClientCapabilities !== 'function') return false
  try {
    const caps = await PKC.getClientCapabilities()
    return caps['extension:prf'] === false
  } catch {
    return false
  }
}

export async function enrollBiometric(rawDek: Uint8Array): Promise<EnrollResult> {
  if (await prfKnownUnsupported()) return { status: 'unsupported' }
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
 * Why an unlock failed. Every one of these used to be the same `null` (or
 * a thrown OperationError the caller read as "sheet dismissed"), so a
 * passkey that could never work again looked exactly like a passkey you
 * had just chosen not to use: Face ID succeeded and nothing happened.
 */
export type UnlockResult =
  | { status: 'ok'; rawDek: Uint8Array; credentialId: string }
  /** No enrollment here — the button should not have been offered. */
  | { status: 'none' }
  /** The assertion came back without a PRF output: this browser can't. */
  | { status: 'no-prf' }
  /**
   * The passkey is real and answered, but its key opens nothing here —
   * the vault was restored or re-created after enrolling. Unrecoverable
   * by retrying: the caller drops *this* enrollment and says so.
   */
  | { status: 'stale'; credentialId: string }
  /** The authenticator answered with a credential that is not ours. */
  | { status: 'failed' }

/**
 * Authenticate and return the raw DEK bytes (the caller passes them to
 * vault.unlockWithRawDek, which wipes them). Throws only on user cancel
 * and on genuine platform errors; the ways this can legitimately fail
 * come back as a status.
 */
export async function biometricUnlock(): Promise<UnlockResult> {
  const rows = await db.auth.toArray()
  if (rows.length === 0) return { status: 'none' }
  // One enrollment is the normal case (Settings offers a single switch),
  // and `eval` is the older, far more widely implemented half of the PRF
  // extension — Safari in particular is happier with it. Only reach for
  // evalByCredential when there really is more than one credential to
  // tell apart.
  const prf: AuthenticationExtensionsPRFInputs =
    rows.length === 1
      ? { eval: { first: rows[0].prfSalt as BufferSource } }
      : {
          evalByCredential: Object.fromEntries(
            rows.map((r) => [
              bufferToBase64Url(fromHex(r.id)),
              { first: r.prfSalt as BufferSource },
            ]),
          ),
        }
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
      extensions: { prf } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!asserted) return { status: 'no-prf' }
  const row = rows.find((r) => r.id === toHex(new Uint8Array(asserted.rawId)))
  // We asked for our own credentials by id, so an answer from anything
  // else is a platform oddity, not a passkey to retire.
  if (!row) return { status: 'failed' }
  const prfOutput = prfOutputOf(asserted)
  if (!prfOutput) return { status: 'no-prf' }
  try {
    const kek = await deriveKeyFromPrf(prfOutput, row.hkdfSalt)
    const rawDek = await unwrapDek({ iv: row.wrappedDekIv, ciphertext: row.wrappedDek }, kek)
    return { status: 'ok', rawDek, credentialId: row.id }
  } catch (error) {
    // AES-GCM refusing the wrap — and only that — means the PRF output
    // is not the one that made it: the passkey belongs to a vault that
    // is gone. Every other failure here is the platform having a bad
    // moment, and must not cost the user an enrollment that still works.
    if (error instanceof DOMException && error.name === 'OperationError') {
      return { status: 'stale', credentialId: row.id }
    }
    throw error
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
