import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { markUpdateReady, wireUpdate } from './lib/appUpdate'
import { applyDisguise } from './lib/disguise'
import { requestPersistentStorage } from './lib/platform'
import './styles.css'

// Frame-busting (§6.2): the meta CSP cannot carry frame-ancestors, so a
// hostile page could iframe the app as a passphrase-phishing overlay.
// Refuse to boot framed rather than render an unlock form there.
if (window.top !== window.self) {
  throw new Error('refusing to run inside a frame')
}

// Swap manifest/title/icons to the chosen disguise before anything —
// including an install prompt — reads them (§6.5).
applyDisguise()

// Durability, not privacy (§7): ask the browser not to evict IndexedDB;
// the result is surfaced on the Settings page.
void requestPersistentStorage()

// Check for a new build hourly — an installed PWA that is never fully
// closed (and a hash router that never navigates) would otherwise run a
// stale build indefinitely. A build that arrives waits to be taken at a
// quiet moment (lib/appUpdate.ts) rather than reloading mid-sentence.
wireUpdate(
  registerSW({
    immediate: true,
    onNeedRefresh: markUpdateReady,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000)
    },
  }),
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
