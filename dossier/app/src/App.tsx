import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_BACKGROUND_GRACE_SECONDS,
} from './lib/models'
import { selectSettings, useVaultStore } from './store/vaultStore'
import UnlockPage from './pages/UnlockPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import SettingsPage from './pages/SettingsPage'

// The graph pulls in d3-force; keep it out of the unlock-screen bundle.
const GraphPage = lazy(() => import('./pages/GraphPage'))

/** Warn this long before the inactivity lock fires (when the timer allows). */
const LOCK_WARNING_MS = 15_000

export default function App() {
  const status = useVaultStore((s) => s.status)
  const init = useVaultStore((s) => s.init)
  const lock = useVaultStore((s) => s.lock)
  const panicLock = useVaultStore((s) => s.panicLock)
  const flushDrafts = useVaultStore((s) => s.flushDrafts)
  const settings = useVaultStore((s) =>
    s.status === 'unlocked' ? selectSettings(s.records) : undefined,
  )
  const autoLockMinutes = settings?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES
  const graceSeconds = settings?.backgroundGraceSeconds ?? DEFAULT_BACKGROUND_GRACE_SECONDS
  const unlocked = status === 'unlocked'
  const [lockWarning, setLockWarning] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // Timer-driven locks save any in-progress capture draft as an encrypted
  // note first — a memory aid must not eat the fact you just typed. The
  // panic Lock button skips this: panic means drop everything NOW.
  const timerLock = async () => {
    try {
      await flushDrafts()
    } finally {
      lock()
    }
  }

  // Backgrounding starts a grace timer before locking (§6.3): an instant
  // lock would destroy capture drafts on every notification tap and break
  // the OS file picker. Returning within the window cancels it. Armed at
  // effect setup too — the page may already be hidden when the vault
  // unlocks (the WebAuthn sheet backgrounds the page on some platforms).
  useEffect(() => {
    if (!unlocked) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      timer ??= setTimeout(() => void timerLock(), Math.max(1, graceSeconds) * 1000)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') arm()
      else if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    if (document.visibilityState === 'hidden') arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer !== undefined) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, graceSeconds])

  // Inactivity auto-lock (§6.3): any interaction — including text input
  // and dictation, which fire no pointer/key events — resets the
  // countdown; a warning shows shortly before the lock.
  useEffect(() => {
    if (!unlocked || autoLockMinutes <= 0) return
    let lockTimer: ReturnType<typeof setTimeout>
    let warnTimer: ReturnType<typeof setTimeout> | undefined
    const totalMs = autoLockMinutes * 60_000
    const reset = () => {
      clearTimeout(lockTimer)
      if (warnTimer !== undefined) clearTimeout(warnTimer)
      setLockWarning(false)
      if (totalMs > LOCK_WARNING_MS * 2) {
        warnTimer = setTimeout(() => setLockWarning(true), totalMs - LOCK_WARNING_MS)
      }
      lockTimer = setTimeout(() => {
        setLockWarning(false)
        void timerLock()
      }, totalMs)
    }
    reset()
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'input']
    for (const ev of events) document.addEventListener(ev, reset, { passive: true })
    return () => {
      clearTimeout(lockTimer)
      if (warnTimer !== undefined) clearTimeout(warnTimer)
      setLockWarning(false)
      for (const ev of events) document.removeEventListener(ev, reset)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, autoLockMinutes])

  if (status === 'unknown') return null
  if (status !== 'unlocked') return <UnlockPage mode={status === 'no-vault' ? 'create' : 'unlock'} />

  return (
    <div className="app">
      <header className="app-bar">
        <nav aria-label="Main">
          <NavLink to="/" end>
            People
          </NavLink>
          <NavLink to="/graph">Graph</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        {/* Panic lock (§6.4): drops the DEK AND the session PIN. */}
        <button
          className="lock-button"
          onClick={panicLock}
          aria-label="Lock now (PIN is discarded; passphrase or biometrics to reopen)"
          title="Lock now — PIN is discarded; passphrase or biometrics to reopen"
        >
          Lock
        </button>
      </header>
      {lockWarning && (
        <p className="banner lock-warning" role="status">
          Locking soon — touch anywhere to stay unlocked.
        </p>
      )}
      <main>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<PeoplePage />} />
            <Route path="/person/:id" element={<PersonPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
