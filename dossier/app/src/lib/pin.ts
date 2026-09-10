/**
 * PIN quick re-unlock (REQUIREMENTS.md §6.3 method 3).
 *
 * The PIN wraps a SESSION copy of the DEK that lives only in this
 * module's memory: never IndexedDB, never localStorage. Closing the tab
 * ends the session; an attacker with the disk has nothing PIN-derived to
 * attack, and an attacker with the locked-but-open app gets exactly
 * MAX_ATTEMPTS guesses before the wrap is destroyed and the passphrase is
 * required again. Failed guesses are additionally counted across
 * successes (failuresSinceLastSuccess) so the owner can be told someone
 * tried PINs while they were away.
 *
 * The panic lock (§6.4) calls disarmPin() — a panic must leave nothing
 * PIN-openable in memory; only the timer-driven auto-locks keep the
 * session armed.
 */
import { decryptBlob, derivePinKey, encryptBlob, randomBytes, wipe } from './crypto'

export const MAX_PIN_ATTEMPTS = 5

interface PinSession {
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
  pinLength: number
  attemptsLeft: number
}

let session: PinSession | null = null
let failedSinceSuccess = 0

export function pinArmed(): boolean {
  return session !== null
}

export function pinAttemptsLeft(): number {
  return session?.attemptsLeft ?? 0
}

/** Armed PIN's digit count (memory only) — lets the unlock UI auto-submit. */
export function pinLength(): number {
  return session?.pinLength ?? 0
}

/**
 * Failed PIN guesses since the last successful unlock, then reset —
 * surfaced to the owner as a tamper signal after they get back in.
 */
export function takeFailedAttemptsReport(): number {
  const n = failedSinceSuccess
  failedSinceSuccess = 0
  return n
}

/** Arm the PIN for this browser session. Wipes nothing — caller owns rawDek. */
export async function armPin(pin: string, rawDek: Uint8Array): Promise<void> {
  const salt = randomBytes(16)
  const key = await derivePinKey(pin, salt)
  const { iv, blob } = await encryptBlob(key, rawDek)
  session = { salt, iv, ct: blob, pinLength: pin.length, attemptsLeft: MAX_PIN_ATTEMPTS }
}

export function disarmPin(): void {
  if (session) {
    wipe(session.ct)
    session = null
  }
}

export type PinResult =
  | { ok: true; rawDek: Uint8Array }
  | { ok: false; attemptsLeft: number }

/**
 * Try the PIN. Wrong guesses burn attempts; the last failure disarms the
 * session entirely (full lock, passphrase required). Only a GCM
 * authentication failure counts as a wrong guess — infrastructure errors
 * (KDF unavailable) never burn attempts.
 */
export async function tryPinUnlock(pin: string): Promise<PinResult> {
  const snapshot = session
  if (!snapshot) return { ok: false, attemptsLeft: 0 }
  const key = await derivePinKey(pin, snapshot.salt)
  try {
    const rawDek = await decryptBlob(key, { iv: snapshot.iv, blob: snapshot.ct })
    if (session === snapshot) session.attemptsLeft = MAX_PIN_ATTEMPTS
    return { ok: true, rawDek }
  } catch {
    // A concurrent disarm may have wiped the session; never crash, never
    // double-count.
    if (session !== snapshot) return { ok: false, attemptsLeft: 0 }
    session.attemptsLeft -= 1
    failedSinceSuccess += 1
    const attemptsLeft = session.attemptsLeft
    if (attemptsLeft <= 0) disarmPin()
    return { ok: false, attemptsLeft }
  }
}
