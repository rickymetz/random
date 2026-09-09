import { useRef, useState } from 'react'
import { MAX_PIN_ATTEMPTS } from '../lib/pin'
import { webAuthnAvailable } from '../lib/webauthn'
import { useVaultStore } from '../store/vaultStore'

const MIN_PASSPHRASE_LENGTH = 8

/**
 * Deliberately bland (REQUIREMENTS.md §6.5): no vault metadata, no counts,
 * no product branding. autoComplete="off" keeps the vault passphrase out
 * of browser/OS password managers (§6.2: key material never leaves the
 * device). When a session PIN is armed it is the default quick path;
 * biometric unlock shows when an enrollment exists (§6.3). Both screens
 * link to each other.
 */
export default function UnlockPage({ mode }: { mode: 'create' | 'unlock' }) {
  const pinArmed = useVaultStore((s) => s.pinArmed)
  const [usePassphrase, setUsePassphrase] = useState(false)

  if (mode === 'unlock' && pinArmed && !usePassphrase) {
    return <PinUnlock onUsePassphrase={() => setUsePassphrase(true)} />
  }
  return (
    <PassphraseForm
      mode={mode}
      onUsePin={pinArmed ? () => setUsePassphrase(false) : undefined}
    />
  )
}

function BiometricButton({ onError }: { onError: (message: string | null) => void }) {
  const biometricEnrolled = useVaultStore((s) => s.biometricEnrolled)
  const unlockWithBiometric = useVaultStore((s) => s.unlockWithBiometric)
  const [busy, setBusy] = useState(false)
  if (!biometricEnrolled || !webAuthnAvailable()) return null
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          if (!(await unlockWithBiometric())) onError('Biometric unlock failed — use another method.')
        } catch {
          // Dismissing the platform sheet is not a failure — stay quiet.
          onError(null)
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? '…' : 'Unlock with biometrics'}
    </button>
  )
}

function PinUnlock({ onUsePassphrase }: { onUsePassphrase: () => void }) {
  const unlockWithPin = useVaultStore((s) => s.unlockWithPin)
  const pinAttemptsLeft = useVaultStore((s) => s.pinAttemptsLeft)
  const pinDigits = useVaultStore((s) => s.pinDigits)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const submit = async (value: string) => {
    if (!value || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await unlockWithPin(value)
      if (result === 'wrong') {
        const state = useVaultStore.getState()
        setError(
          state.pinArmed
            ? `Wrong PIN — ${state.pinAttemptsLeft} tr${state.pinAttemptsLeft === 1 ? 'y' : 'ies'} left.`
            : null, // lock-out message is shown by the passphrase screen
        )
      } else if (result === 'stale') {
        setError(null)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
      setPin('')
    }
  }

  return (
    <form
      className="unlock"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(pin)
      }}
    >
      <input
        // A masked field that still gets the numeric keypad on iOS:
        // type=password forces QWERTY there, so mask via CSS instead.
        type="text"
        className="pin-input"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={8}
        autoFocus
        value={pin}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '')
          setPin(digits)
          // Auto-submit when the armed PIN's length is reached — the whole
          // point of a PIN is not reaching for another button.
          if (pinDigits > 0 && digits.length === pinDigits) void submit(digits)
        }}
        placeholder="PIN"
        aria-label="PIN"
        autoComplete="off"
      />
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      {pinAttemptsLeft > 0 && pinAttemptsLeft < MAX_PIN_ATTEMPTS && !error && (
        <p className="hint">{pinAttemptsLeft} tries left.</p>
      )}
      <button type="submit" disabled={busy || !pin}>
        {busy ? '…' : 'Open'}
      </button>
      <BiometricButton onError={setError} />
      <button type="button" className="subtle" onClick={onUsePassphrase}>
        Use passphrase
      </button>
    </form>
  )
}

function PassphraseForm({
  mode,
  onUsePin,
}: {
  mode: 'create' | 'unlock'
  onUsePin?: () => void
}) {
  const create = useVaultStore((s) => s.create)
  const unlock = useVaultStore((s) => s.unlock)
  const pinLockedOut = useVaultStore((s) => s.pinLockedOut)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passphrase || busy) return
    setError(null)
    if (mode === 'create') {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters — this passphrase is the only key.`)
        return
      }
      if (passphrase !== confirm) {
        setError('Passphrases do not match.')
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        await create(passphrase)
      } else if (!(await unlock(passphrase))) {
        setError('Wrong passphrase — check for autocorrect or a stray capital.')
      }
    } catch {
      setError('Something went wrong opening the vault. Try again.')
    } finally {
      setBusy(false)
      setPassphrase('')
      setConfirm('')
    }
  }

  return (
    <form className="unlock" onSubmit={submit}>
      {mode === 'unlock' && pinLockedOut && (
        <p className="hint" role="status">
          The quick-unlock PIN was disabled after too many wrong tries. Unlock with your
          passphrase, then re-arm a PIN in Settings if you want one.
        </p>
      )}
      <input
        type="password"
        autoFocus
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder={mode === 'create' ? 'Choose a passphrase' : 'Passphrase'}
        aria-label={mode === 'create' ? 'Choose a passphrase' : 'Passphrase'}
        autoComplete="off"
      />
      {mode === 'create' && (
        <>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat passphrase"
            aria-label="Repeat passphrase"
            autoComplete="off"
          />
          <p className="hint">
            There is no recovery. If you forget this passphrase, the data is gone.
          </p>
        </>
      )}
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !passphrase}>
        {busy ? '…' : mode === 'create' ? 'Create' : 'Open'}
      </button>
      {mode === 'unlock' && <BiometricButton onError={setError} />}
      {onUsePin && (
        <button type="button" className="subtle" onClick={onUsePin}>
          Use PIN
        </button>
      )}
    </form>
  )
}
