import { useState } from 'react'
import { useVaultStore } from '../store/vaultStore'

const MIN_PASSPHRASE_LENGTH = 8

/**
 * Deliberately bland (REQUIREMENTS.md §6.5): no vault metadata, no counts,
 * no product branding. autoComplete="off" keeps the vault passphrase out
 * of browser/OS password managers (§6.2: key material never leaves the
 * device). Biometric (WebAuthn PRF) unlock lands here in slice 2.
 */
export default function UnlockPage({ mode }: { mode: 'create' | 'unlock' }) {
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
    </form>
  )
}
