import { useEffect, useRef, useState } from 'react'
import { destroyAllData } from '../lib/db'
import {
  MAX_IMPORT_FILE_BYTES,
  exportBundle,
  exportFileName,
  importBundle,
} from '../lib/export'
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_BACKGROUND_GRACE_SECONDS,
} from '../lib/models'
import { DISGUISES, currentDisguise, setDisguise } from '../lib/disguise'
import { MAX_PIN_ATTEMPTS } from '../lib/pin'
import { getStorageStatus } from '../lib/platform'
import { requestNotificationPermission } from '../lib/reminders'
import { loadAllBlobs, unlockVault } from '../lib/vault'
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
      <DisguiseSection />
      <ExportSection />
      <ImportSection />
      <StorageSection />
      <section className="danger-zone">
        <h2>Danger</h2>
        <p className="hint">
          Nothing ever leaves this device except encrypted backups, so this is the whole
          story: wipe here, and it's gone.
        </p>
        <button className="danger" onClick={destroy}>
          Destroy all data
        </button>
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
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinPass, setPinPass] = useState('')
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [bioPass, setBioPass] = useState('')
  const [bioMsg, setBioMsg] = useState<string | null>(null)
  const [bioBusy, setBioBusy] = useState(false)
  const [lockMsg, setLockMsg] = useState<string | null>(null)

  // "Saved." is a transient confirmation, not state to leave on screen;
  // errors stay until the next attempt.
  useEffect(() => {
    if (lockMsg !== 'Saved.') return
    const timer = setTimeout(() => setLockMsg(null), 2500)
    return () => clearTimeout(timer)
  }, [lockMsg])

  const armPin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pinBusy) return
    setPinMsg(null)
    if (!/^\d{4,8}$/.test(pin)) {
      setPinMsg('PIN must be 4–8 digits.')
      return
    }
    if (pin !== pinConfirm) {
      setPinMsg('PINs do not match.')
      return
    }
    setPinBusy(true)
    try {
      setPinMsg((await setPin(pin, pinPass)) ? null : 'Wrong passphrase.')
    } finally {
      setPinBusy(false)
      setPinValue('')
      setPinConfirm('')
      setPinPass('')
    }
  }

  const enroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (bioBusy) return
    setBioMsg(null)
    setBioBusy(true)
    try {
      const result = await enrollBiometric(bioPass)
      if (result === 'wrong-passphrase') setBioMsg('Wrong passphrase.')
      else if (result === 'cancelled') setBioMsg(null)
      else if (result === 'unsupported')
        setBioMsg(
          'This device/browser does not support biometric (PRF) unlock. If a "Ledger" passkey was created anyway, remove it in your system password settings.',
        )
    } finally {
      setBioBusy(false)
      setBioPass('')
    }
  }

  const changeSecurity = async (
    patch: Parameters<typeof updateSecurity>[0],
  ): Promise<void> => {
    setLockMsg(null)
    try {
      await updateSecurity(patch)
      setLockMsg('Saved.')
    } catch {
      setLockMsg('Could not save — check storage and try again.')
    }
  }

  return (
    <section>
      <h2>Security</h2>

      <h3>Quick unlock PIN</h3>
      {pinArmed ? (
        <div className="row">
          <p className="hint" role="status">
            PIN armed. It lives only in this app session — never on disk — and is gone
            after the app fully closes or {MAX_PIN_ATTEMPTS} wrong tries; the passphrase
            always works. The Lock button also discards it (panic); timed auto-locks
            keep it.
          </p>
          <button className="subtle" onClick={forgetPin}>
            Disable
          </button>
        </div>
      ) : (
        <form className="pin-form" onSubmit={armPin}>
          <div className="row wrap">
            <label className="field">
              <span>New PIN</span>
              <input
                type="text"
                className="pin-input"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                placeholder="4–8 digits"
                aria-label="New PIN"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Repeat PIN</span>
              <input
                type="text"
                className="pin-input"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                placeholder="again"
                aria-label="Repeat new PIN"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Vault passphrase</span>
              <input
                type="password"
                value={pinPass}
                onChange={(e) => setPinPass(e.target.value)}
                placeholder="authorizes the PIN"
                aria-label="Vault passphrase to authorize the PIN"
                autoComplete="off"
              />
            </label>
            <button type="submit" disabled={pinBusy || !pin || !pinConfirm || !pinPass}>
              {pinBusy ? '…' : 'Arm'}
            </button>
          </div>
          <p className="hint">
            Lasts until the app fully closes; re-arm here after a restart.
          </p>
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
          <p className="hint" role="status">
            Enrolled — Face ID / fingerprint opens the vault. Removing here deletes the
            app's copy; the passkey itself lives in your system password settings.
          </p>
          <button className="subtle" onClick={() => void removeBiometric().catch(() => {})}>
            Remove
          </button>
        </div>
      ) : (
        <form className="row wrap" onSubmit={enroll}>
          <label className="field">
            <span>Vault passphrase</span>
            <input
              type="password"
              value={bioPass}
              onChange={(e) => setBioPass(e.target.value)}
              placeholder="authorizes enrollment"
              aria-label="Vault passphrase to authorize biometrics"
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={bioBusy || !bioPass}>
            {bioBusy ? '…' : 'Enroll'}
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
            onChange={(e) => {
              const minutes = Number(e.target.value)
              if (
                minutes === 0 &&
                !confirm(
                  'Disable the inactivity lock? A borrowed or forgotten open phone would stay unlocked indefinitely.',
                )
              ) {
                return
              }
              void changeSecurity({ autoLockMinutes: minutes })
            }}
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
              void changeSecurity({ backgroundGraceSeconds: Number(e.target.value) })
            }
            aria-label="Background lock grace period"
          >
            <option value={5}>5 s</option>
            <option value={30}>30 s</option>
            <option value={120}>2 min</option>
          </select>
        </label>
        <span
          className={`status-slot hint ${lockMsg === 'Saved.' ? '' : 'error'}`}
          role="status"
        >
          {lockMsg}
        </span>
      </div>

      <h3>Discretion</h3>
      <div className="column">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings?.shakeToLock ?? false}
            onChange={async (e) => {
              const enable = e.target.checked
              if (enable) {
                if (typeof DeviceMotionEvent === 'undefined') {
                  setLockMsg('This browser has no motion sensor access.')
                  return
                }
                // iOS gates motion events behind a permission prompt that
                // must come from a user gesture — this is that gesture.
                const dme = DeviceMotionEvent as unknown as {
                  requestPermission?: () => Promise<string>
                }
                if (typeof dme?.requestPermission === 'function') {
                  try {
                    if ((await dme.requestPermission()) !== 'granted') return
                  } catch {
                    return
                  }
                }
              }
              void changeSecurity({ shakeToLock: enable })
            }}
          />
          Shake to lock (three hard jolts panic-lock the vault)
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings?.remindersEnabled ?? false}
            onChange={async (e) => {
              const enable = e.target.checked
              if (enable && !(await requestNotificationPermission())) return
              void changeSecurity({ remindersEnabled: enable })
            }}
          />
          Daily reminder notification — always generic (“You have a reminder”), never a
          name
        </label>
      </div>
    </section>
  )
}

/** Neutral install name/icon (§6.5). The choice is the public face. */
function DisguiseSection() {
  const [selected, setSelected] = useState(() => currentDisguise().id)
  const base = import.meta.env.BASE_URL
  return (
    <section>
      <h2>Appearance</h2>
      <p className="hint">
        The name and icon this app installs under — pick whatever blends into your home
        screen. On iOS, re-add to the Home Screen after changing to update the icon.
      </p>
      <div className="row wrap">
        {DISGUISES.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`disguise-option ${selected === d.id ? 'selected' : ''}`}
            aria-pressed={selected === d.id}
            onClick={() => {
              setDisguise(d.id)
              setSelected(d.id)
            }}
          >
            <img src={`${base}${d.icon}`} alt="" width={40} height={40} />
            {d.name}
          </button>
        ))}
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
      const blobs = await loadAllBlobs(vault)
      const text = await exportBundle(passphrase, [...records.values()], blobs)
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
        <label className="field">
          <span>Confirm passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="unlocks the export"
            aria-label="Confirm passphrase"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={!passphrase || state === 'busy'} aria-busy={state === 'busy'}>
          {state === 'busy' ? '…' : 'Export'}
        </button>
      </form>
      {state === 'busy' && (
        <p className="hint" role="status">
          Preparing encrypted backup — large photo collections take a moment…
        </p>
      )}
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError('That file is too large to be a valid backup.')
      return
    }
    setBusy(true)
    try {
      const restored = await importBundle(passphrase, await file.text())
      if (restored === null) {
        setError('Wrong passphrase for this backup.')
        return
      }
      const count = await importRecords(restored.records, restored.blobs)
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
        <label className="field">
          <span>Backup file</span>
          <input
            ref={fileRef}
            type="file"
            accept=".ledger,application/json"
            aria-label="Backup file"
          />
        </label>
        <div className="row">
          <label className="field">
            <span>Backup passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="the passphrase it was made with"
              aria-label="Backup passphrase"
              autoComplete="off"
            />
          </label>
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
