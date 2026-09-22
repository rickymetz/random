import { useEffect, useRef, useState, type ReactNode } from 'react'
import FormEditor from '../components/FormEditor'
import InlineField from '../components/InlineField'
import TypeEditor from '../components/TypeEditor'
import LabelText from '../components/LabelText'
import { Link, useSearchParams } from 'react-router-dom'
import {
  applyUpdate,
  buildLabel,
  checkForUpdate,
  isUpdateReady,
  onUpdateReady,
  type UpdateCheck,
} from '../lib/appUpdate'
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
    const answer = prompt('Type DELETE to confirm. There is no undo.')
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
      <FormEditor />
      <TypeEditor />
      <SecuritySection />
      <DisguiseSection />
      <SampleDataSection />
      <UpdateSection />
      {dev && <StressSection />}
      <section className="danger-zone">
        <h2>Delete everything</h2>
        <p className="hint">
          Wipes every note and person from this device. Without a backup, they’re gone.
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
          'Your phone or browser can’t do this. Use the PIN instead. If a passkey for this app was made anyway, delete it in the phone’s password settings.',
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
      setLockMsg('Couldn’t save. Your device may be out of space.')
    }
  }

  return (
    <section>
      <h2>Security</h2>

      <h3>PIN</h3>
      {pinArmed ? (
        <div className="row">
          <p role="status">PIN is on</p>
          <button className="subtle" onClick={forgetPin}>
            Turn off
          </button>
        </div>
      ) : null}
      {pinArmed ? (
        <div>
          <p className="hint">
            Lasts until you fully close the app, {MAX_PIN_ATTEMPTS} wrong tries, or “Lock
            &amp; forget PIN”. Auto-lock keeps it.
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
                aria-label="Your passphrase"
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
            Lasts until you fully close the app; after that, unlock with your passphrase
            and set one again.
          </p>
        </form>
      )}
      <h3>Face ID / fingerprint unlock</h3>
      {!webAuthnAvailable() ? (
        <p className="hint">Your browser can't do this — use the PIN instead.</p>
      ) : biometricEnrolled ? (
        <div className="row">
          <p className="hint" role="status">
            On. Turning it off here leaves the passkey in your device’s password settings —
            remove it there too if you want.
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
              aria-label="Your passphrase"
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
        <InlineField label="When I stop using it">
          <select
            value={settings?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES}
            onChange={(e) => {
              const minutes = Number(e.target.value)
              if (
                minutes === 0 &&
                !confirm(
                  'Turn off auto-lock? If you leave your phone unlocked, the app stays open until you lock it yourself.',
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
        </InlineField>
        <InlineField label="When I switch to another app">
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
        </InlineField>
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
          Shake three times to lock
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
          <LabelText text="Daily reminder" desc="the notification never names anyone" />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings?.nameSuggestions ?? true}
            onChange={(e) => void changeSecurity({ nameSuggestions: e.target.checked })}
          />
          Suggest people from names in notes
        </label>
        {reminderNotice && (
          <p className="hint error" role="alert">
            {reminderNotice}
          </p>
        )}
        {isIosBrowserTab() && (
          <p className="hint">
            On iPhone, reminders only work in the Home Screen app, and only while it’s
            open. See “Add to Home Screen” below.
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
        Share → Add to Home Screen gives you a full-screen app that can show reminders.
        It keeps its own notes, separate from this tab.
      </p>
      <p className="hint">
        {hasContent
          ? 'Save a backup below, then restore it in the app.'
          : 'Set your passphrase there, not here.'}
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
        Pick whatever blends in. On iPhone, re-add the app after changing to update the
        icon.
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
        {changed && `Now showing as ${changed}`}
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
        Saves everything to a file only your passphrase can open. Keep it in iCloud or
        Drive; Restore brings it back on a new phone.
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
          Making your backup — lots of photos take a moment…
        </p>
      )}
      {state === 'wrong' && (
        <p className="hint error" role="alert">
          Wrong passphrase.
        </p>
      )}
      {state === 'failed' && (
        <p className="hint error" role="alert">
          Couldn’t save the backup — try again.
        </p>
      )}
      {state === 'done' && (
        <p className="hint">Backup saved</p>
      )}
    </section>
  )
}

function ImportSection() {
  const importRecords = useVaultStore((s) => s.importRecords)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
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
      setMessage(`Restored ${count} items`)
      if (fileRef.current) fileRef.current.value = ''
      setFileName('')
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Couldn’t restore that file.')
    } finally {
      setBusy(false)
      setPassphrase('')
    }
  }

  return (
    <section>
      <h2>Restore</h2>
      <p className="hint">
        Brings a backup file back in. Nothing here is removed; if an entry is in both,
        the newer one wins. For phone contacts, use “Import contacts…” on the People page.
      </p>
      <form className="column" onSubmit={doImport}>
        {/* The browser's own file control drew a second bordered button
            inside our field, with its own lowercase "no file selected":
            a button of ours opens the same picker, and says what's
            chosen in the app's voice — as Import contacts already does. */}
        <div className="field">
          <span id="backup-file-label">Backup file</span>
          <input
            ref={fileRef}
            type="file"
            hidden
            // iOS maps accept to UTIs and can grey out a .ledger file in
            // the Files picker; the importer validates the contents anyway.
            accept={isIos() ? undefined : '.ledger,.planner,.grid,application/json'}
            aria-label="Backup file"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
          />
          <div className="row file-pick">
            <button
              type="button"
              aria-describedby="backup-file-label backup-file-name"
              onClick={() => fileRef.current?.click()}
            >
              {fileName ? 'Choose another…' : 'Choose file…'}
            </button>
            <span className="hint file-name" id="backup-file-name">
              {fileName || 'None chosen'}
            </span>
          </div>
        </div>
        <div className="row wrap restore-row">
          <label className="field">
            <span>Backup passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
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
        'Add 14 fictional people (tagged ‘sample’) with relationships and 3 circles? You can delete them later.',
      )
    ) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { peopleAdded, edgesAdded, skippedNoSelf, circlesAdded } = await loadSampleData()
      if (peopleAdded === 0 && edgesAdded === 0 && circlesAdded === 0) {
        setMessage('Sample people are already here.')
      } else {
        setMessage(
          <>
            Added {peopleAdded} people, {edgesAdded} relationships and {circlesAdded} circles —
            open the <Link to="/graph">Graph</Link>.
            {skippedNoSelf > 0 &&
              ` ${skippedNoSelf} relationships to you were left out: no one is marked “This is me”. Mark yourself, then load again.`}
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
        A small fictional cast to try the graph with. Loading again only fills gaps.
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

/**
 * Which build this is, and a way to fetch a newer one now. An installed
 * copy finds new builds on its own (hourly while open) and takes them the
 * next time it locks; this is for "a fix just shipped — do I have it?",
 * which used to mean deleting the app from the Home Screen and adding it
 * back. The app's name stays out of it: a disguised copy must not say
 * "Ledger".
 */
function UpdateSection() {
  const [state, setState] = useState<UpdateCheck | 'checking' | 'stuck' | 'waiting' | null>(() =>
    isUpdateReady() ? 'waiting' : null,
  )
  // The hourly check may find one while this page is open.
  useEffect(
    () =>
      onUpdateReady(() =>
        setState((s) => (s === null || s === 'current' || s === 'offline' ? 'waiting' : s)),
      ),
    [],
  )
  const [hasWorker, setHasWorker] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    if (!navigator.serviceWorker) setHasWorker(false)
    else
      navigator.serviceWorker
        .getRegistration()
        .then((r) => live && setHasWorker(Boolean(r)))
        .catch(() => live && setHasWorker(false))
    return () => {
      live = false
    }
  }, [])
  // The new build reloads the page itself once it takes over. If that
  // hasn't happened after a while (a slow download, a browser that never
  // said), offer to reopen by hand rather than leave "installing" forever.
  useEffect(() => {
    if (state !== 'updating') return
    const t = window.setTimeout(() => setState('stuck'), 20_000)
    return () => window.clearTimeout(t)
  }, [state])

  const check = async () => {
    if (state === 'checking' || state === 'updating') return
    if (state === 'waiting') {
      setState('updating')
      void applyUpdate()
      return
    }
    setState('checking')
    const result = await checkForUpdate()
    setState(result)
    // Asked for, so taken now — as soon as it has installed. Nothing is
    // being written on this page; notes in progress are on disk anyway.
    if (result === 'updating') void applyUpdate()
  }
  const message: Record<Exclude<typeof state, null>, string> = {
    checking: 'Checking…',
    waiting: 'A new version is ready. It installs the next time the app locks — or now.',
    current: 'You have the latest version.',
    updating: 'Found a new version — installing. The app will reopen on it, locked.',
    stuck: 'The new version is ready. Reopen the app to start using it.',
    offline: 'Couldn’t reach the server. Try again when you’re online.',
    unavailable: 'This browser loads the latest version each time you open the app.',
  }
  return (
    <section>
      <h2>Updates</h2>
      <p className="hint">
        Version {buildLabel(__APP_VERSION__, __BUILD_ID__, __BUILD_TIME__)}. New versions
        arrive on their own and install when the app locks; check to get one straight away.
      </p>
      {hasWorker !== false && (
        <div className="row wrap">
          <button
            type="button"
            onClick={() => void check()}
            disabled={state === 'checking' || state === 'updating'}
          >
            {state === 'waiting' ? 'Install now' : 'Check for updates'}
          </button>
          {state === 'stuck' && (
            <button type="button" className="primary" onClick={() => location.reload()}>
              Reopen now
            </button>
          )}
        </div>
      )}
      <p className="hint status-slot" role="status">
        {state ? message[state] : hasWorker === false ? message.unavailable : ''}
      </p>
    </section>
  )
}

/** Surface the storage-durability answer the browser gave us (§7). */
function StorageSection() {
  const status = getStorageStatus()
  const label =
    status.persisted === true
      ? 'Kept only on this device; the browser has agreed not to clear them.'
      : status.persisted === false
        ? 'Kept only on this device. The browser may clear them if you don’t open the app for a while — save a backup now and then.'
        : 'Kept only on this device. The browser didn’t say whether it might clear them — save a backup now and then.'
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
