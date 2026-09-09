/**
 * PIN quick re-unlock (REQUIREMENTS.md §6.3 method 3).
 *
 * The PIN wraps a SESSION copy of the DEK that lives only in this
 * module's memory: never IndexedDB, never localStorage. Closing the tab
 * ends the session; an attacker with the disk has nothing PIN-derived to
 * attack, and an attacker with the locked-but-open app gets exactly
 * MAX_ATTEMPTS guesses before the wrap is destroyed and the passphrase is
 * required again.
 */
import { decryptBlob, derivePinKey, encryptBlob, randomBytes, wipe } from './crypto'

const MAX_ATTEMPTS = 5

interface PinSession {
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
  attemptsLeft: number
}

let session: PinSession | null = null

export function pinArmed(): boolean {
  return session !== null
}

export function pinAttemptsLeft(): number {
  return session?.attemptsLeft ?? 0
}

/** Arm the PIN for this browser session. Wipes nothing — caller owns rawDek. */
export async function armPin(pin: string, rawDek: Uint8Array): Promise<void> {
  const salt = randomBytes(16)
  const key = await derivePinKey(pin, salt)
  const { iv, blob } = await encryptBlob(key, rawDek)
  session = { salt, iv, ct: blob, attemptsLeft: MAX_ATTEMPTS }
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
 * session entirely (full lock, passphrase required).
 */
export async function tryPinUnlock(pin: string): Promise<PinResult> {
  if (!session) return { ok: false, attemptsLeft: 0 }
  try {
    const key = await derivePinKey(pin, session.salt)
    const rawDek = await decryptBlob(key, { iv: session.iv, blob: session.ct })
    session.attemptsLeft = MAX_ATTEMPTS
    return { ok: true, rawDek }
  } catch {
    session.attemptsLeft -= 1
    const attemptsLeft = session.attemptsLeft
    if (attemptsLeft <= 0) disarmPin()
    return { ok: false, attemptsLeft }
  }
}
