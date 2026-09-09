import { Suspense, lazy, useEffect } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { useVaultStore } from './store/vaultStore'
import UnlockPage from './pages/UnlockPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import SettingsPage from './pages/SettingsPage'

// The graph pulls in d3-force; keep it out of the unlock-screen bundle.
const GraphPage = lazy(() => import('./pages/GraphPage'))

/**
 * Backgrounding starts a short grace timer before locking (§6.3): an
 * immediate lock would destroy in-progress capture drafts on every
 * notification tap and break the OS file picker (which backgrounds the
 * page). Returning within the grace window cancels the lock. The one-tap
 * Lock button remains the instant path (§6.4). Slice 2 makes the timer
 * configurable alongside PIN/biometric unlock.
 */
const BACKGROUND_LOCK_GRACE_MS = 30_000

export default function App() {
  const status = useVaultStore((s) => s.status)
  const init = useVaultStore((s) => s.init)
  const lock = useVaultStore((s) => s.lock)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        timer ??= setTimeout(() => lock(), BACKGROUND_LOCK_GRACE_MS)
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
  }, [lock])

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
