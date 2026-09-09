import { useState } from 'react'
import { useVaultStore } from '../store/vaultStore'

/**
 * Deliberately bland (REQUIREMENTS.md §6.5): no vault metadata, no counts,
 * no product branding. Biometric (WebAuthn PRF) unlock lands here in v1.
 */
export default function UnlockPage({ mode }: { mode: 'create' | 'unlock' }) {
  const create = useVaultStore((s) => s.create)
  const unlock = useVaultStore((s) => s.unlock)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passphrase || busy) return
    setBusy(true)
    setError(false)
    try {
      if (mode === 'create') {
        await create(passphrase)
      } else if (!(await unlock(passphrase))) {
        setError(true)
      }
    } finally {
      setBusy(false)
      setPassphrase('')
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
        autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
      />
      {mode === 'create' && (
        <p className="hint">
          There is no recovery. If you forget this passphrase, the data is gone.
        </p>
      )}
      {error && <p className="hint error">Try again.</p>}
      <button type="submit" disabled={busy || !passphrase}>
        {busy ? '…' : mode === 'create' ? 'Create' : 'Open'}
      </button>
    </form>
  )
}
