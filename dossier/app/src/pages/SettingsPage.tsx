import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { PIN_MASK_SUPPORTED, getStorageStatus, isIos, isIosBrowserTab } from '../lib/platform'
import { requestNotificationPermission } from '../lib/reminders'
import { loadSampleData } from '../lib/sampleData'
import { loadStressCast, removeStressCast } from '../lib/stressData'
import { loadAllBlobs, unlockVault } from '../lib/vault'
import { webAuthnAvailable } from '../lib/webauthn'
import { selectPeople, selectSettings, useVaultStore } from '../store/vaultStore'

export default function SettingsPage() {
  const lock = useVaultStore((s) => s.lock)
  // Profiling tools live behind #/settings?dev=1 — not a feature.
  const [params] = useSearchParams()
  const dev = params.get('dev') === '1'

  const destroy = async () => {
    const answer = prompt('Type DELETE to destroy all data on this device. There is no undo.')
    if (answer !== 'DELETE') return
    await destroyAllData()
    lock()
    location.reload()
  }

  return (
    <div className="settings">
      <h1 className="sr-only">Settings</h1>
      {/* What a new user needs first: the install caveat (iOS tab) and the
          backup habit, before the long Security block. */}
      {isIosBrowserTab() && <InstallSection />}
      <ExportSection />
      <ImportSection />
      <StorageSection />
      <SecuritySection />
      <DisguiseSection />
      <SampleDataSection />
      {dev && <StressSection />}
      <section className="danger-zone">
        <h2>Delete everything</h2>
        <p className="hint">
          Wipes every note and person from this device. There's no copy anywhere else
          unless you saved a backup, so this really is gone.
        </p>
        <button className="danger" onClick={destroy}>
          Delete everything
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
  const [reminderNotice, setReminderNotice] = useState<string | null>(null)
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
      const ok = await setPin(pin, pinPass)
      setPinMsg(ok ? null : 'Wrong passphrase.')
      // A passphrase typo shouldn't cost retyping the PIN twice.
      if (ok) {
        setPinValue('')
        setPinConfirm('')
      }
    } finally {
      setPinBusy(false)
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
          "Your phone or browser can't do this kind of unlock — use the PIN instead. If a passkey for this app was created anyway, you can remove it in your phone's password settings.",
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
          <p role="status">PIN is on ✓</p>
          <button className="subtle" onClick={forgetPin}>
            Turn off
          </button>
        </div>
      ) : null}
      {pinArmed ? (
        <div>
          <p className="hint">
            Works until you fully close the app; cleared after {MAX_PIN_ATTEMPTS} wrong
            tries or by “Lock &amp; forget PIN” at the top. Auto-lock keeps it.
          </p>
        </div>
      ) : (
        <form className="pin-form" onSubmit={armPin}>
          <div className="row wrap">
            <label className="field">
              <span>New PIN</span>
              <input
                type={PIN_MASK_SUPPORTED ? 'text' : 'password'}
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
                type={PIN_MASK_SUPPORTED ? 'text' : 'password'}
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
              <span>Your passphrase</span>
              <input
                type="password"
                value={pinPass}
                onChange={(e) => setPinPass(e.target.value)}
                placeholder="to confirm it's you"
                aria-label="Vault passphrase to authorize the PIN"
                autoComplete="off"
              />
            </label>
            <button type="submit" disabled={pinBusy || !pin || !pinConfirm || !pinPass}>
              {pinBusy ? '…' : 'Turn on PIN'}
            </button>
          </div>
          {pinMsg && (
            <p className="hint error" role="alert">
              {pinMsg}
            </p>
          )}
          <p className="hint">
            A short code for quick unlocking. It works until you fully close the app;
            after that, enter your passphrase once and set it again here.
          </p>
        </form>
      )}
      <h3>Face ID / fingerprint unlock</h3>
      {!webAuthnAvailable() ? (
        <p className="hint">Your browser can't do this — use the PIN instead.</p>
      ) : biometricEnrolled ? (
        <div className="row">
          <p className="hint" role="status">
            On — your face or fingerprint opens the app. Turning it off here removes
            the app's copy; the passkey itself lives in your device's password settings.
          </p>
          <button className="subtle" onClick={() => void removeBiometric().catch(() => {})}>
            Turn off
          </button>
        </div>
      ) : (
        <form className="row wrap" onSubmit={enroll}>
          <label className="field">
            <span>Your passphrase</span>
            <input
              type="password"
              value={bioPass}
              onChange={(e) => setBioPass(e.target.value)}
              placeholder="to confirm it's you"
              aria-label="Vault passphrase to authorize biometrics"
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={bioBusy || !bioPass}>
            {bioBusy ? 'Waiting for your phone…' : 'Turn on Face ID'}
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
          When I stop using it
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
          When I switch to another app
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

      <h3>Privacy</h3>
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
          Shake the phone three times to lock instantly
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings?.remindersEnabled ?? false}
            onChange={async (e) => {
              const enable = e.target.checked
              if (enable && !(await requestNotificationPermission())) {
                setReminderNotice(
                  'Notifications are blocked for this app — allow them in the phone’s settings, then try again.',
                )
                return
              }
              setReminderNotice(null)
              void changeSecurity({ remindersEnabled: enable })
            }}
          />
          Daily reminder — the notification only ever says “You have a reminder”, never
          who it's about
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings?.nameSuggestions ?? true}
            onChange={(e) => void changeSecurity({ nameSuggestions: e.target.checked })}
          />
          Suggest people from names in notes — a simple pattern match on this device;
          nothing is sent anywhere and declined names aren't saved
        </label>
        {reminderNotice && (
          <p className="hint error" role="alert">
            {reminderNotice}
          </p>
        )}
        {isIosBrowserTab() && (
          <p className="hint">
            On iPhone, reminders only work from the Home Screen app (and only while it's
            open) — see “Add to Home Screen” below.
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * iOS-only: a Safari tab and the Home Screen app are separate worlds
 * (storage, notifications, Face ID prompts). Say so before someone
 * builds up a vault in the tab and finds the app empty.
 */
function InstallSection() {
  const records = useVaultStore((s) => s.records)
  const hasContent = selectPeople(records).some((p) => !p.isSelf)
  return (
    <section>
      <h2>Add to Home Screen</h2>
      <p className="hint">
        You're using this in a browser tab. Added to the Home Screen (in Safari: Share →
        Add to Home Screen) it opens full-screen and can show reminders while it's open.
      </p>
      <p className="hint">
        The Home Screen app keeps its own storage, separate from the browser — and vice
        versa.{' '}
        {hasContent
          ? 'Your notes here won’t appear in it by themselves: save a backup below, open the app, and restore it there.'
          : 'Set up your passphrase inside the app, not here.'}
      </p>
    </section>
  )
}

/** Neutral install name/icon (§6.5). The choice is the public face. */
function DisguiseSection() {
  const [selected, setSelected] = useState(() => currentDisguise().id)
  const [changed, setChanged] = useState<string | null>(null)
  const base = import.meta.env.BASE_URL
  return (
    <section>
      <h2>Name &amp; icon on your Home Screen</h2>
      <p className="hint">
        If you add this app to your home screen (Share → Add to Home Screen), this is
        the name and icon it shows — pick whatever blends in. On iPhone, re-add it
        after changing to update the icon.
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
              setChanged(d.name)
            }}
          >
            <img src={`${base}${d.icon}`} alt="" width={40} height={40} />
            {d.name}
          </button>
        ))}
      </div>
      <p className="hint status-slot" role="status">
        {changed && `Now showing as ${changed} ✓ — on iPhone, re-add to your Home Screen to update the icon.`}
      </p>
    </section>
  )
}

function downloadBlob(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking synchronously races the (async) download start.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
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
      const name = exportFileName()
      // iOS: an <a download> of a blob: URL is unreliable from a Home
      // Screen app (it can navigate the app to the raw JSON with no way
      // back). The share sheet saves to Files/AirDrop from both a tab and
      // the installed app. Cancelling the sheet is not a failure.
      const file = new File([text], name, { type: 'application/json' })
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean
      }
      if (isIos() && nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name })
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') {
            setState('idle')
            return
          }
          downloadBlob(text, name)
        }
      } else {
        downloadBlob(text, name)
      }
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
        Saves a copy of everything to a file. It's scrambled with your passphrase, so
        only you can open it — keep it somewhere safe like iCloud or Drive, and use
        Restore below to bring it back on a new phone.
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
            placeholder="to confirm it's you"
            aria-label="Confirm passphrase"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={!passphrase || state === 'busy'} aria-busy={state === 'busy'}>
          {state === 'busy' ? '…' : 'Save backup'}
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
      {state === 'done' && (
        <p className="hint">Backup saved ✓</p>
      )}
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
    if (!file) {
      setError('Choose a backup file first.')
      return
    }
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
      setMessage(`Restored ✓ — ${count} items`)
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
        Bring back notes from a backup file. What's already here stays; where both
        have the same entry, the newer one wins. On a new phone: set a passphrase,
        then restore here. Looking to bring in your phone’s contacts instead? Use
        “Import contacts…” at the end of the People list.
      </p>
      <form className="column" onSubmit={doImport}>
        <label className="field">
          <span>Backup file</span>
          <input
            ref={fileRef}
            type="file"
            // iOS maps accept to UTIs and can grey out a .ledger file in
            // the Files picker; the importer validates the contents anyway.
            accept={isIos() ? undefined : '.ledger,application/json'}
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

/**
 * Seed a fictional, interconnected cast so the graph view has something
 * to show before real people accumulate. Everything it adds is ordinary
 * vault data — edit or delete any of them like a real entry.
 */
function SampleDataSection() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<ReactNode>(null)

  const seed = async () => {
    if (busy) return
    if (
      !confirm(
        "Add 14 fictional people (tagged 'sample'), their relationships, and 3 circles to explore the graph? You can delete them individually later.",
      )
    ) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { peopleAdded, edgesAdded, skippedNoSelf, circlesAdded } = await loadSampleData()
      if (peopleAdded === 0 && edgesAdded === 0 && circlesAdded === 0) {
        setMessage('Sample cast is already here.')
      } else {
        setMessage(
          <>
            Added {peopleAdded} people, {edgesAdded} relationships, and {circlesAdded} circles —
            open the <Link to="/graph">Graph</Link> (tap a tinted area to edit a circle).
            {skippedNoSelf > 0 &&
              ` ${skippedNoSelf} relationships to you were skipped because no person is marked "This is me" — mark one and load again.`}
          </>,
        )
      }
    } catch {
      setMessage('Could not load the sample data — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Sample data</h2>
      <p className="hint">
        Load a small fictional cast — overlapping work, family, and climbing circles —
        to see what the relationship graph can do. Running it again only fills gaps.
      </p>
      <button onClick={() => void seed()} disabled={busy} aria-busy={busy}>
        {busy ? 'Adding…' : 'Load sample people'}
      </button>
      {/* Always mounted so the polite live region reliably announces. */}
      <p className="hint status-slot" role="status">
        {message}
      </p>
    </section>
  )
}

/**
 * Scale testing (§7): bulk-load a fictional crowd in one write, and take
 * it away again. Dev-only (`?dev=1`); the counts and timing feed the
 * profiling script.
 */
function StressSection() {
  const records = useVaultStore((s) => s.records)
  const [size, setSize] = useState(300)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const total = records.size

  const add = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await loadStressCast(size)
      setMessage(
        `Added ${r.people} people, ${r.notes} notes, ${r.edges} relationships, ${r.circles} circles, ${r.followUps} follow-ups, ${r.photos} photos in ${r.ms} ms.`,
      )
    } catch {
      setMessage('Could not load the crowd — try again.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const t0 = performance.now()
      const n = await removeStressCast()
      setMessage(`Removed ${n} people in ${Math.round(performance.now() - t0)} ms.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stress">
      <h2>Stress test</h2>
      <p className="hint">
        Adds a large fictional crowd (tagged ‘stress-test’) to see how the app copes.
        Currently holding {total} records.
      </p>
      <div className="row wrap">
        <label className="stress-size">
          People
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[100, 300, 1000, 3000].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void add()} disabled={busy} aria-busy={busy}>
          {busy ? 'Working…' : 'Add crowd'}
        </button>
        <button className="danger" onClick={() => void remove()} disabled={busy}>
          Remove crowd
        </button>
      </div>
      <p className="hint status-slot" role="status">
        {message}
      </p>
    </section>
  )
}

/** Surface the storage-durability answer the browser gave us (§7). */
function StorageSection() {
  const status = getStorageStatus()
  const label =
    status.persisted === true
      ? 'Your notes live only on this device, and the browser has agreed to keep them even if you don’t open the app for a long time.'
      : status.persisted === false
        ? 'Your notes live only on this device. If you don’t open the app for a long time, the browser may clear them to free space — so save a backup now and then.'
        : 'Your notes live only on this device. This browser didn’t say whether it might clear them — save a backup now and then.'
  return (
    <section>
      <h2>Storage</h2>
      <p className="hint">
        {label}
        {status.usageBytes !== null && (
          <>
            {' '}
            {status.usageBytes < 100_000
              ? 'Using under 1 MB.'
              : `Using ${(status.usageBytes / 1024 / 1024).toFixed(1)} MB.`}
          </>
        )}
      </p>
    </section>
  )
}
