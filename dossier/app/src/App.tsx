import { useEffect } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { useVaultStore } from './store/vaultStore'
import UnlockPage from './pages/UnlockPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import GraphPage from './pages/GraphPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const status = useVaultStore((s) => s.status)
  const init = useVaultStore((s) => s.init)
  const lock = useVaultStore((s) => s.lock)

  useEffect(() => {
    void init()
  }, [init])

  // Auto-lock on backgrounding (REQUIREMENTS.md §6.3). The inactivity
  // timer and PIN re-unlock window layer on top of this later.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') lock()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [lock])

  if (status === 'unknown') return null
  if (status !== 'unlocked') return <UnlockPage mode={status === 'no-vault' ? 'create' : 'unlock'} />

  return (
    <div className="app">
      <header className="app-bar">
        <nav>
          <Link to="/">People</Link>
          <Link to="/graph">Graph</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        {/* Instant lock: always one tap away (§6.4). */}
        <button className="lock-button" onClick={lock} aria-label="Lock now">
          Lock
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/person/:id" element={<PersonPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
