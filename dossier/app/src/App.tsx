import { Suspense, lazy, useEffect } from 'react'
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

export default function App() {
  const status = useVaultStore((s) => s.status)
  const init = useVaultStore((s) => s.init)
  const lock = useVaultStore((s) => s.lock)
  const settings = useVaultStore((s) =>
    s.status === 'unlocked' ? selectSettings(s.records) : undefined,
  )
  const autoLockMinutes = settings?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES
  const graceSeconds = settings?.backgroundGraceSeconds ?? DEFAULT_BACKGROUND_GRACE_SECONDS
  const unlocked = status === 'unlocked'

  useEffect(() => {
    void init()
  }, [init])

  // Backgrounding starts a grace timer before locking (§6.3): an instant
  // lock would destroy capture drafts on every notification tap and break
  // the OS file picker. Returning within the window cancels it. The
  // one-tap Lock button remains the instant path (§6.4).
  useEffect(() => {
    if (!unlocked) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        timer ??= setTimeout(() => lock(), Math.max(1, graceSeconds) * 1000)
      } else if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [lock, unlocked, graceSeconds])

  // Inactivity auto-lock (§6.3): any interaction resets the countdown.
  useEffect(() => {
    if (!unlocked || autoLockMinutes <= 0) return
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => lock(), autoLockMinutes * 60_000)
    }
    reset()
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    for (const ev of events) document.addEventListener(ev, reset, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const ev of events) document.removeEventListener(ev, reset)
    }
  }, [lock, unlocked, autoLockMinutes])

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
        {/* Instant lock: always one tap away (§6.4). */}
        <button className="lock-button" onClick={lock} aria-label="Lock now">
          Lock
        </button>
      </header>
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
