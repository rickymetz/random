import { useEffect, useState } from 'react'
import { webAuthnAvailable } from '../lib/webauthn'
import { useVaultStore } from '../store/vaultStore'

const MIN_PASSPHRASE_LENGTH = 8

/**
 * Deliberately bland (REQUIREMENTS.md §6.5): no vault metadata, no counts,
 * no product branding. autoComplete="off" keeps the vault passphrase out
 * of browser/OS password managers (§6.2: key material never leaves the
 * device). When a session PIN is armed it is the default quick path;
 * biometric unlock shows when an enrollment exists (§6.3).
 */
export default function UnlockPage({ mode }: { mode: 'create' | 'unlock' }) {
  const pinArmed = useVaultStore((s) => s.pinArmed)
  const [usePassphrase, setUsePassphrase] = useState(false)

  if (mode === 'unlock' && pinArmed && !usePassphrase) {
    return <PinUnlock onUsePassphrase={() => setUsePassphrase(true)} />
  }
  return <PassphraseForm mode={mode} />
}

function BiometricButton({ onError }: { onError: (message: string) => void }) {
  const biometricEnrolled = useVaultStore((s) => s.biometricEnrolled)
  const unlockWithBiometric = useVaultStore((s) => s.unlockWithBiometric)
  const [busy, setBusy] = useState(false)
  if (!biometricEnrolled || !webAuthnAvailable()) return null
  return (
    <button
      type="button"
      className="subtle"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          if (!(await unlockWithBiometric())) onError('Biometric unlock failed — use another method.')
        } catch {
          onError('Biometric unlock failed — use another method.')
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
  const pinStillArmed = useVaultStore((s) => s.pinArmed)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    setError(null)
    try {
      if (!(await unlockWithPin(pin))) {
        const state = useVaultStore.getState()
        setError(
          state.pinArmed
            ? `Wrong PIN — ${state.pinAttemptsLeft} tr${state.pinAttemptsLeft === 1 ? 'y' : 'ies'} left.`
            : 'Too many tries. Use your passphrase.',
        )
      }
    } finally {
      setBusy(false)
      setPin('')
    }
  }

  // Attempts exhausted (or PIN forgotten) — fall through to passphrase.
  useEffect(() => {
    if (!pinStillArmed) onUsePassphrase()
  }, [pinStillArmed, onUsePassphrase])

  return (
    <form className="unlock" onSubmit={submit}>
      <input
        type="password"
        inputMode="numeric"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN"
        aria-label="PIN"
        autoComplete="off"
      />
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      {pinAttemptsLeft > 0 && pinAttemptsLeft < 5 && !error && (
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

function PassphraseForm({ mode }: { mode: 'create' | 'unlock' }) {
  const create = useVaultStore((s) => s.create)
  const unlock = useVaultStore((s) => s.unlock)
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
        setError('Try again.')
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
    </form>
  )
}
