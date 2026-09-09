import { useRef, useState } from 'react'
import { destroyAllData } from '../lib/db'
import { exportBundle, exportFileName, importBundle } from '../lib/export'
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_BACKGROUND_GRACE_SECONDS,
} from '../lib/models'
import { getStorageStatus } from '../lib/platform'
import { unlockVault } from '../lib/vault'
import { webAuthnAvailable } from '../lib/webauthn'
import { selectSettings, useVaultStore } from '../store/vaultStore'

export default function SettingsPage() {
  const lock = useVaultStore((s) => s.lock)

  const destroy = async () => {
    const answer = prompt('Type DELETE to destroy all data on this device. There is no undo.')
    if (answer !== 'DELETE') return
    await destroyAllData()
    lock()
    location.reload()
  }

  return (
    <div className="settings">
      <SecuritySection />
      <ExportSection />
      <ImportSection />
      <StorageSection />
      <section>
        <h2>Danger</h2>
        <button className="danger" onClick={destroy}>
          Destroy all data
        </button>
        <p className="hint">
          Nothing ever leaves this device except encrypted backups, so this is the whole
          story: wipe here, and it's gone.
        </p>
      </section>
    </div>
  )
}

/** Unlock methods and lock timers (§6.3). */
function SecuritySection() {
  const records = useVaultStore((s) => s.records)
  const pinArmed = useVaultStore((s) => s.pinArmed)
  const biometricEnrolled = useVaultStore((s) => s.biometricEnrolled)
  const setPin = useVaultStore((s) => s.setPin)
  const forgetPin = useVaultStore((s) => s.forgetPin)
  const enrollBiometric = useVaultStore((s) => s.enrollBiometric)
  const removeBiometric = useVaultStore((s) => s.removeBiometric)
  const updateSecurity = useVaultStore((s) => s.updateSecurity)
  const settings = selectSettings(records)

  const [pin, setPinValue] = useState('')
  const [pinPass, setPinPass] = useState('')
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  const [bioPass, setBioPass] = useState('')
  const [bioMsg, setBioMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const armPin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setPinMsg(null)
    if (!/^\d{4,8}$/.test(pin)) {
      setPinMsg('PIN must be 4–8 digits.')
      return
    }
    setBusy(true)
    try {
      setPinMsg(
        (await setPin(pin, pinPass))
          ? null
          : 'Wrong passphrase.',
      )
    } finally {
      setBusy(false)
      setPinValue('')
      setPinPass('')
    }
  }

  const enroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBioMsg(null)
    setBusy(true)
    try {
      const result = await enrollBiometric(bioPass)
      if (result === 'wrong-passphrase') setBioMsg('Wrong passphrase.')
      else if (result === 'unsupported')
        setBioMsg('This device/browser does not support biometric (PRF) unlock.')
    } finally {
      setBusy(false)
      setBioPass('')
    }
  }

  return (
    <section>
      <h2>Security</h2>

      <h3>Quick unlock PIN</h3>
      {pinArmed ? (
        <div className="row">
          <p className="hint">
            PIN armed for this session — it is never stored, and 5 wrong tries fall back
            to the passphrase.
          </p>
          <button className="subtle" onClick={forgetPin}>
            Disable
          </button>
        </div>
      ) : (
        <form className="row wrap" onSubmit={armPin}>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPinValue(e.target.value)}
            placeholder="PIN (4–8 digits)"
            aria-label="New PIN"
            autoComplete="off"
          />
          <input
            type="password"
            value={pinPass}
            onChange={(e) => setPinPass(e.target.value)}
            placeholder="Passphrase"
            aria-label="Passphrase to authorize PIN"
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !pin || !pinPass}>
            Arm
          </button>
        </form>
      )}
      {pinMsg && (
        <p className="hint error" role="alert">
          {pinMsg}
        </p>
      )}

      <h3>Biometric unlock</h3>
      {!webAuthnAvailable() ? (
        <p className="hint">Not available in this browser.</p>
      ) : biometricEnrolled ? (
        <div className="row">
          <p className="hint">Enrolled — Face ID / fingerprint opens the vault.</p>
          <button className="subtle" onClick={() => void removeBiometric()}>
            Remove
          </button>
        </div>
      ) : (
        <form className="row wrap" onSubmit={enroll}>
          <input
            type="password"
            value={bioPass}
            onChange={(e) => setBioPass(e.target.value)}
            placeholder="Passphrase"
            aria-label="Passphrase to authorize biometrics"
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !bioPass}>
            Enroll
          </button>
        </form>
      )}
      {bioMsg && (
        <p className="hint error" role="alert">
          {bioMsg}
        </p>
      )}

      <h3>Auto-lock</h3>
      <div className="row wrap">
        <label className="inline-check">
          After inactivity
          <select
            value={settings?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES}
            onChange={(e) => void updateSecurity({ autoLockMinutes: Number(e.target.value) })}
            aria-label="Inactivity auto-lock"
          >
            <option value={0}>never</option>
            <option value={1}>1 min</option>
            <option value={2}>2 min</option>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
          </select>
        </label>
        <label className="inline-check">
          After backgrounding
          <select
            value={settings?.backgroundGraceSeconds ?? DEFAULT_BACKGROUND_GRACE_SECONDS}
            onChange={(e) =>
              void updateSecurity({ backgroundGraceSeconds: Number(e.target.value) })
            }
            aria-label="Background lock grace period"
          >
            <option value={5}>5 s</option>
            <option value={30}>30 s</option>
            <option value={120}>2 min</option>
          </select>
        </label>
      </div>
    </section>
  )
}

/**
 * Encrypted export (§4.5): re-entering the passphrase both keys the bundle
 * and proves the user still knows it. The unlock check must open THIS
 * vault's slot — any-slot acceptance would let a decoy passphrase key a
 * backup of the real vault's records (§6.6).
 */
function ExportSection() {
  const records = useVaultStore((s) => s.records)
  const vault = useVaultStore((s) => s.vault)
  const markExported = useVaultStore((s) => s.markExported)
  const settings = selectSettings(records)
  const [passphrase, setPassphrase] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'wrong' | 'failed'>('idle')

  const doExport = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('busy')
    try {
      const opened = await unlockVault(passphrase)
      if (!opened || opened.slotId !== vault?.slotId) {
        setState('wrong')
        return
      }
      const text = await exportBundle(passphrase, [...records.values()])
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName()
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoking synchronously races the (async) download start.
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      await markExported()
      setState('done')
    } catch {
      setState('failed')
    } finally {
      setPassphrase('')
    }
  }

  return (
    <section>
      <h2>Backup</h2>
      <p className="hint">
        Downloads an encrypted backup — the only way data leaves this device. It opens
        with your passphrase on any device; without it, the file is noise.
        {settings?.lastExportAt && (
          <> Last backup: {new Date(settings.lastExportAt).toLocaleDateString()}.</>
        )}
      </p>
      <form className="row" onSubmit={doExport}>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Confirm passphrase"
          aria-label="Confirm passphrase"
          autoComplete="off"
        />
        <button type="submit" disabled={!passphrase || state === 'busy'}>
          {state === 'busy' ? '…' : 'Export'}
        </button>
      </form>
      {state === 'wrong' && (
        <p className="hint error" role="alert">
          That's not this vault's passphrase.
        </p>
      )}
      {state === 'failed' && (
        <p className="hint error" role="alert">
          Export failed — try again.
        </p>
      )}
      {state === 'done' && <p className="hint">Backup saved.</p>}
    </section>
  )
}

function ImportSection() {
  const importRecords = useVaultStore((s) => s.importRecords)
  const fileRef = useRef<HTMLInputElement>(null)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    setError(null)
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const restored = await importBundle(passphrase, await file.text())
      if (restored === null) {
        setError('Wrong passphrase for this backup.')
        return
      }
      const count = await importRecords(restored)
      setMessage(`Restored ${count} records.`)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
      setPassphrase('')
    }
  }

  return (
    <section>
      <h2>Restore</h2>
      <p className="hint">
        Merges a backup into this vault (newer entries win by id). On a fresh device:
        create a vault, then restore here.
      </p>
      <form className="column" onSubmit={doImport}>
        <input
          ref={fileRef}
          type="file"
          accept=".ledger,application/json"
          aria-label="Backup file"
        />
        <div className="row">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Backup passphrase"
            aria-label="Backup passphrase"
            autoComplete="off"
          />
          <button type="submit" disabled={!passphrase || busy}>
            {busy ? '…' : 'Restore'}
          </button>
        </div>
      </form>
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      {message && <p className="hint">{message}</p>}
    </section>
  )
}

/** Surface the storage-durability answer the browser gave us (§7). */
function StorageSection() {
  const status = getStorageStatus()
  const label =
    status.persisted === true
      ? 'Protected — the browser agreed not to evict this app’s storage.'
      : status.persisted === false
        ? 'NOT protected — the browser may evict this data if the app goes unused. Keep backups current.'
        : 'Unknown — this browser didn’t say. Keep backups current.'
  return (
    <section>
      <h2>Storage</h2>
      <p className="hint">
        {label}
        {status.usageBytes !== null && (
          <> Using {(status.usageBytes / 1024 / 1024).toFixed(1)} MB.</>
        )}
      </p>
    </section>
  )
}
