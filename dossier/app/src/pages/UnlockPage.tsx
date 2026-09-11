import { useRef, useState } from 'react'
import { MAX_PIN_ATTEMPTS } from '../lib/pin'
import { PIN_MASK_SUPPORTED, isIosBrowserTab } from '../lib/platform'
import { webAuthnAvailable } from '../lib/webauthn'
import { useVaultStore } from '../store/vaultStore'

const MIN_PASSPHRASE_LENGTH = 8

/**
 * Deliberately bland (REQUIREMENTS.md §6.5): no vault metadata, no counts,
 * no product branding — the mark is an abstract shape and the heading says
 * only what to do. autoComplete="off" asks browsers not to offer saving
 * the passphrase; most ignore it on password fields, so a user accepting
 * their browser's save prompt can still sync it off-device — there is no
 * reliable web-side block (§6.2 caveat). When a session PIN is armed it
 * is the default quick path;
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

function UnlockMark() {
  return (
    <span className="unlock-mark" aria-hidden="true">
      {'◈'}
    </span>
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
      className="subtle"
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
      <div className="unlock-card">
        <UnlockMark />
        <h1>Enter PIN</h1>
        {/* One dot per typed digit — no empty slots: the locked screen
            must not disclose the armed PIN's length (§6.5). */}
        <div
          className="pin-dots"
          aria-hidden="true"
          // iOS shows no keyboard for autofocus; tapping the dots must.
          onPointerDown={(e) => {
            e.preventDefault()
            document.querySelector<HTMLInputElement>('.pin-input')?.focus()
          }}
        >
          {Array.from({ length: pin.length }, (_, i) => (
            <span key={i} className="on" />
          ))}
        </div>
        <input
          // A masked field that still gets the numeric keypad on iOS:
          // type=password forces QWERTY there, so mask via CSS where the
          // property exists (Firefox lacks it — fall back to password
          // rather than render the PIN in cleartext).
          type={PIN_MASK_SUPPORTED ? 'text' : 'password'}
          className="pin-input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          autoCorrect="off"
          spellCheck={false}
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
        <button type="submit" className="primary" disabled={busy || !pin}>
          {busy ? '…' : 'Open'}
        </button>
      </div>
      <div className="alt">
        <BiometricButton onError={setError} />
        <button type="button" className="quiet" onClick={onUsePassphrase}>
          Use passphrase
        </button>
      </div>
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
        setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters — a short sentence works well.`)
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
      <div className="unlock-card">
        <UnlockMark />
        <h1>{mode === 'create' ? 'Set a passphrase' : 'Enter passphrase'}</h1>
        {mode === 'create' ? (
          <p className="hint">
            Notes about the people you meet, kept only on this device and locked with a
            passphrase only you know. Nobody else holds it, so it can't be reset —
            pick something you'll remember, like three or four words.
          </p>
        ) : (
          <p className="hint">Locked — everything is still here.</p>
        )}
        {mode === 'create' && isIosBrowserTab() && (
          <p className="notice-warn" role="note">
            On iPhone, add this page to your Home Screen first (Share → Add to Home
            Screen) and set up in there. Safari and the Home Screen app keep separate
            storage, so notes made here won't appear in the app.
          </p>
        )}
        {mode === 'unlock' && pinLockedOut && (
          <p className="notice-warn" role="status">
            The quick-unlock PIN was disabled after too many wrong tries. Unlock with
            your passphrase, then re-arm a PIN in Settings if you want one.
          </p>
        )}
        <label>
          Passphrase
          <input
            type="password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={mode === 'create' ? 'Choose a passphrase' : 'Passphrase'}
            aria-label={mode === 'create' ? 'Choose a passphrase' : 'Passphrase'}
            autoComplete="off"
          />
        </label>
        {mode === 'create' && (
          <>
            <label>
              Repeat passphrase
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat passphrase"
                aria-label="Repeat passphrase"
                autoComplete="off"
              />
            </label>
            <p className="hint">
              At least {MIN_PASSPHRASE_LENGTH} characters. There is no reset: if you forget
              it, the notes can't be opened.
            </p>
          </>
        )}
        {error && (
          <p className="hint error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || !passphrase}>
          {busy ? '…' : mode === 'create' ? 'Create' : 'Open'}
        </button>
      </div>
      {(mode === 'unlock' || onUsePin) && (
        <div className="alt">
          {mode === 'unlock' && <BiometricButton onError={setError} />}
          {onUsePin && (
            <button type="button" className="quiet" onClick={onUsePin}>
              Use PIN
            </button>
          )}
        </div>
      )}
    </form>
  )
}
