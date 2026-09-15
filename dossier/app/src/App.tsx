import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
} from 'react-router-dom'
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_BACKGROUND_GRACE_SECONDS,
} from './lib/models'
import { currentDisguise, subscribeDisguise } from './lib/disguise'
import { onLock } from './lib/sessionCaches'
import {
  hasDueItems,
  notificationsGranted,
  showGenericReminder,
  todayStamp,
} from './lib/reminders'
import { selectSettings, useVaultStore } from './store/vaultStore'
import UnlockPage from './pages/UnlockPage'
import PeoplePage from './pages/PeoplePage'
import PersonPage from './pages/PersonPage'
import SettingsPage from './pages/SettingsPage'

// The graph pulls in d3-force; keep it out of the unlock-screen bundle.
const GraphPage = lazy(() => import('./pages/GraphPage'))

/**
 * Remount PersonPage per person: without the key, navigating from one
 * dossier to another keeps component state alive — an open edit form
 * would carry the previous person's fields (and isSelf!) onto the next.
 */
function KeyedPersonPage() {
  const { id } = useParams()
  return <PersonPage key={id} />
}

/**
 * iOS Safari overlays the keyboard on the layout viewport instead of
 * resizing it (the interactive-widget meta only works on Android), which
 * parks bottom-anchored bars (capture bar, form Save) under the keys.
 * Track the visual viewport and expose the covered height as --kb so
 * those bars can lift above it. Pinch-zoom also shrinks the visual
 * viewport; ignore it (scale > 1) so the bars don't jump while zooming.
 */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    let raf = 0
    const update = () => {
      raf = 0
      const zoomed = vv.scale > 1.01
      const inset = zoomed
        ? 0
        : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      root.style.setProperty('--kb', `${inset}px`)
      document.body.classList.toggle('kb-open', inset > 80)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    update()
    return () => {
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      if (raf) cancelAnimationFrame(raf)
      root.style.removeProperty('--kb')
      document.body.classList.remove('kb-open')
    }
  }, [])
}

/**
 * A hash router keeps the window scroll across routes, so tapping a tab
 * from the bottom of a long list landed 2,000px down the next page.
 * Each tab remembers its own place instead (iOS tab-bar model): the
 * scroll is recorded per route while you scroll, and a forward hop to
 * the People or Settings tab lands where you left it. Anything else
 * (a dossier, a circle view) starts at the top; Back keeps the
 * browser's own restore. People remembers the plain list only: a tab
 * tap starts a fresh lookup, so a position taken mid-search would land
 * on different rows.
 */
const TAB_ROUTES = new Set(['/', '/settings'])
const scrollMemory = new Map<string, number>()
onLock(() => scrollMemory.clear())
/** Tapping the tab you are on pops to its top and forgets the place. */
function forgetScroll(route: string) {
  scrollMemory.delete(route)
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}
function useScrollReset() {
  const { pathname, search } = useLocation()
  const navType = useNavigationType()
  const route = pathname + search
  const routeRef = useRef(route)
  routeRef.current = route
  useEffect(() => {
    const onScroll = () => {
      const key = routeRef.current
      if (!TAB_ROUTES.has(key)) return
      if (key === '/' && useVaultStore.getState().homeQuery.trim()) return
      scrollMemory.set(key, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // A layout effect: the page is placed before it is painted, so a
  // remembered position never flashes the top first.
  useLayoutEffect(() => {
    if (navType === 'PUSH') {
      // A search in progress (a facet tap from a dossier) shows other rows
      // than the remembered plain list: start at the top.
      const searching = route === '/' && useVaultStore.getState().homeQuery.trim() !== ''
      const top = TAB_ROUTES.has(route) && !searching ? (scrollMemory.get(route) ?? 0) : 0
      window.scrollTo({ top, behavior: 'instant' as ScrollBehavior })
    }
    // A route change announces nothing on its own (the title stays the
    // disguise): land focus on the new view's heading unless the view
    // already placed it (search box, fresh capture bar). Focus still
    // sitting in the chrome (the tab just tapped, Back) counts as not
    // placed — a screen reader needs to hear where it landed, and that
    // goes for Back (a POP) as much as a forward hop.
    const t = window.setTimeout(() => {
      const a = document.activeElement as HTMLElement | null
      if (a && a !== document.body && !a.closest('nav, .app-bar')) return
      const h1 = document.querySelector<HTMLElement>('main h1')
      if (!h1) return
      h1.tabIndex = -1
      h1.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(t)
  }, [route, navType])
}

/* Tab-bar icons: one stroke weight, one size, so the four read as a set
   (the Unicode glyphs they replace were four different weights). */
const iconProps = {
  className: 'glyph',
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
function PeopleIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c3 0 5.5 1.9 5.5 4.8" />
    </svg>
  )
}
function GraphIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <circle cx="12" cy="6" r="2.5" />
      <path d="M8.2 15.6 10.8 8.3M15.8 15.6 13.2 8.3M8.5 17h7" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </svg>
  )
}
function LockIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/** Warn this long before the inactivity lock fires (when the timer allows). */
const LOCK_WARNING_MS = 20_000

export default function App() {
  const status = useVaultStore((s) => s.status)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const init = useVaultStore((s) => s.init)
  const lock = useVaultStore((s) => s.lock)
  const panicLock = useVaultStore((s) => s.panicLock)
  const flushDrafts = useVaultStore((s) => s.flushDrafts)
  const pinArmed = useVaultStore((s) => s.pinArmed)
  const setHomeQuery = useVaultStore((s) => s.setHomeQuery)
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
  useKeyboardInset()
  useScrollReset()
  // Ctrl/Cmd+K reaches the People search from any page but the graph,
  // which uses the same key for its Find. (A bare "/" would be a
  // single-character shortcut, which speech and switch users trip over.)
  useEffect(() => {
    if (!unlocked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey) return
      if (pathname.startsWith('/graph')) return
      e.preventDefault()
      if (pathname !== '/') navigate('/')
      window.setTimeout(() => {
        document.querySelector<HTMLInputElement>('.people input[type=search]')?.focus()
      }, pathname === '/' ? 0 : 80)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [unlocked, pathname, navigate])

  // Timer-driven locks save any in-progress capture draft as an encrypted
  // note first — a memory aid must not eat the fact you just typed. The
  // wait is bounded: the flush queues behind every in-flight write (a big
  // import can hold the chain for seconds), and a lock must not. A flush
  // that lands after the lock is dropped by the store's epoch guard.
  const timerLock = async () => {
    try {
      await Promise.race([flushDrafts(), new Promise((r) => setTimeout(r, 1500))])
    } finally {
      lock()
    }
  }
  // The panic paths (header button, shake) give the draft a moment too,
  // but §6.4 says "immediately": a third of a second, then the DEK goes.
  const panic = () =>
    void Promise.race([flushDrafts(), new Promise((r) => setTimeout(r, 300))]).finally(() =>
      panicLock(),
    )

  // Backgrounding starts a grace timer before locking (§6.3): an instant
  // lock would destroy capture drafts on every notification tap and break
  // the OS file picker. Returning within the window cancels it. Armed at
  // effect setup too — the page may already be hidden when the vault
  // unlocks (the WebAuthn sheet backgrounds the page on some platforms).
  // Timers alone are not enough: a suspended page (a backgrounded Home
  // Screen app, a frozen tab, the back-forward cache) runs no timers, and
  // on resume the "visible" event would cancel a grace that never got to
  // fire. So the moment of hiding is written down, and coming back after
  // the grace has passed by the wall clock locks at once.
  useEffect(() => {
    if (!unlocked) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let hiddenAt: number | null = null
    const graceMs = Math.max(1, graceSeconds) * 1000
    const arm = () => {
      hiddenAt ??= Date.now()
      timer ??= setTimeout(() => void timerLock(), graceMs)
    }
    const back = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      const overdue = hiddenAt !== null && Date.now() - hiddenAt >= graceMs
      hiddenAt = null
      if (overdue) void timerLock()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') arm()
      else back()
    }
    const onPageHide = () => arm()
    const onPageShow = () => {
      if (document.visibilityState !== 'hidden') back()
    }
    if (document.visibilityState === 'hidden') arm()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
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
    // Wall clock as well as the timer (see the grace effect): a page that
    // slept through its countdown locks on the first sign of life.
    let lastActivityAt = Date.now()
    const reset = () => {
      lastActivityAt = Date.now()
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
    const onWake = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastActivityAt >= totalMs) void timerLock()
    }
    // focusin counts: a screen-reader user reading a long dossier moves
    // focus, not the pointer.
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'input', 'focusin']
    for (const ev of events) document.addEventListener(ev, reset, { passive: true })
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      clearTimeout(lockTimer)
      if (warnTimer !== undefined) clearTimeout(warnTimer)
      setLockWarning(false)
      for (const ev of events) document.removeEventListener(ev, reset)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('pageshow', onWake)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, autoLockMinutes])

  // Shake-to-lock (§6.4): three distinct hard jolts within a second.
  // Gravity-free acceleration where available; the threshold (~2.2 g of
  // true magnitude) plus 120 ms spike spacing keeps walking, jogging,
  // and putting the phone down from panic-locking the vault. A shake is
  // accident-prone, so unlike the deliberate Lock button it DOES flush
  // the capture draft before locking.
  const shakeToLock = settings?.shakeToLock ?? false
  const [motionBlocked, setMotionBlocked] = useState(false)
  useEffect(() => {
    if (!unlocked || !shakeToLock || typeof DeviceMotionEvent === 'undefined') return
    let spikes: number[] = []
    let fired = false
    let listening = false
    const onMotion = (e: DeviceMotionEvent) => {
      if (fired) return
      const a = e.acceleration ?? e.accelerationIncludingGravity
      if (!a) return
      const gravityBias = e.acceleration ? 0 : 9.81
      const magnitude = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2)
      const now = Date.now()
      if (magnitude - gravityBias > 22) {
        spikes = spikes.filter((t) => now - t < 1000)
        if (spikes.length === 0 || now - spikes[spikes.length - 1] > 120) spikes.push(now)
        if (spikes.length >= 3) {
          fired = true
          spikes = []
          panic()
        }
      }
    }
    const listen = () => {
      if (listening) return
      listening = true
      window.addEventListener('devicemotion', onMotion)
    }
    // iOS 13+ delivers no motion events until requestPermission() is
    // granted, and the grant lasts one page load — it must be re-asked
    // (from a user gesture) on every launch, not just when the toggle
    // was first switched on in Settings.
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }
    const onFirstTap = () => {
      window.removeEventListener('pointerdown', onFirstTap, true)
      DME.requestPermission!()
        .then((state) => {
          if (state === 'granted') {
            setMotionBlocked(false)
            listen()
          } else {
            setMotionBlocked(true)
          }
        })
        .catch(() => setMotionBlocked(true))
    }
    if (typeof DME.requestPermission === 'function') {
      window.addEventListener('pointerdown', onFirstTap, true)
    } else {
      listen()
    }
    return () => {
      window.removeEventListener('pointerdown', onFirstTap, true)
      window.removeEventListener('devicemotion', onMotion)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, shakeToLock, panicLock])

  // Daily generic reminder notification (§4.4/§6.5): at most one per
  // day; text never names anyone. Re-checked hourly so a session left
  // open across midnight still fires. Background delivery needs a push
  // service (v2) — the in-app Upcoming view is the guaranteed path.
  const remindersEnabled = settings?.remindersEnabled ?? false
  const lastReminderDay = settings?.lastReminderDay
  const updateSecurity = useVaultStore((s) => s.updateSecurity)
  useEffect(() => {
    if (!unlocked || !remindersEnabled || !notificationsGranted()) return
    const check = () => {
      const today = todayStamp()
      const state = useVaultStore.getState()
      if (selectSettings(state.records)?.lastReminderDay === today) return
      if (!hasDueItems(state.records)) return
      // Stamp the day only when the notification actually showed.
      void showGenericReminder().then((shown) => {
        if (shown) void updateSecurity({ lastReminderDay: today }).catch(() => undefined)
      })
    }
    check()
    const timer = setInterval(check, 60 * 60 * 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, remindersEnabled, lastReminderDay])

  // Re-render the brand when the disguise changes in Settings.
  const disguiseId = useSyncExternalStore(subscribeDisguise, () => currentDisguise().id)
  void disguiseId

  if (status === 'unknown') return null
  if (status !== 'unlocked')
    return (
      <main id="main" className="unlock-main" tabIndex={-1}>
        <UnlockPage mode={status === 'no-vault' ? 'create' : 'unlock'} />
      </main>
    )

  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main"
        // Under a hash router "#main" is a route; skip by moving focus.
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>
      <header className="app-bar">
        {/* Back rides the sticky bar so it's reachable however far a
            dossier is scrolled. A deep link (notification, pasted URL)
            has nothing behind it: Back must land on People, not leave
            the app. Hidden by CSS while the facts form is open. */}
        {pathname.startsWith('/person/') && (
          <button
            className="subtle back icon"
            onClick={() => {
              const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
              if (idx > 0) navigate(-1)
              else navigate('/', { replace: true })
            }}
            aria-label="Back to People"
          >
            <svg {...iconProps} aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span className="back-label" aria-hidden="true">
              People
            </span>
          </button>
        )}
        {/* The brand echoes the disguise, not the product (§6.5). */}
        <span className="brand">{currentDisguise().name}</span>
        {/* A route may put one control here (the graph's Find). */}
        <span id="appbar-slot" className="appbar-slot" />
        <nav aria-label="Main">
          <NavLink to="/" end onClick={() => pathname === '/' && forgetScroll('/')}>
            People
          </NavLink>
          <NavLink to="/graph">Graph</NavLink>
          <NavLink
            to="/settings"
            onClick={() => pathname === '/settings' && forgetScroll('/settings')}
          >
            Settings
          </NavLink>
        </nav>
        {/* Panic lock (§6.4): drops the DEK AND the session PIN. It gives a
            capture draft a moment to save first (bounded, see `panic`).
            Named so it can't be confused with the tab-bar Lock. */}
        <button
          // On a phone the tab bar already has an everyday Lock; the header
          // one earns its place only when it does something more (dropping
          // an armed PIN), so it hides until then.
          className={`lock-button ${pinArmed ? 'panic' : 'plain'}`}
          onClick={panic}
          aria-label={
            pinArmed
              ? 'Lock & forget PIN — reopen with your passphrase or Face ID'
              : 'Lock — reopen with your passphrase or Face ID'
          }
          title={
            pinArmed
              ? 'Lock and forget the PIN — passphrase or biometrics to reopen'
              : 'Lock — passphrase or biometrics to reopen'
          }
        >
          {pinArmed ? 'Lock & forget PIN' : 'Lock'}
        </button>
      </header>
      {lockWarning && (
        <p className="banner lock-warning" role="status">
          Locks in 20 seconds — tap or press a key to stay unlocked. Drafts are saved either way.
        </p>
      )}
      {motionBlocked && unlocked && (
        <p className="banner" role="status">
          Shake to lock is off — motion access was denied. Allow it in Settings → Safari →
          Motion &amp; Orientation Access.{' '}
          <button className="subtle" onClick={() => setMotionBlocked(false)}>
            Dismiss
          </button>
        </p>
      )}
      <main id="main" tabIndex={-1}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<PeoplePage />} />
            <Route path="/person/:id" element={<KeyedPersonPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {/* Mobile-only bottom tabs (hidden ≥48rem): nav where the thumb
          lives, with Lock as the most reachable control in the app. */}
      <nav className="tabbar" aria-label="Main">
        {/* Tapping People from another tab starts a fresh lookup at the
            place you were browsing; the query persists only for Back
            from a dossier. On the tab you're already on, it pops to the top. */}
        <NavLink
          to="/"
          end
          onClick={() => {
            setHomeQuery('')
            if (pathname === '/') forgetScroll('/')
          }}
        >
          <PeopleIcon />
          People
        </NavLink>
        <NavLink to="/graph">
          <GraphIcon />
          Graph
        </NavLink>
        <NavLink
          to="/settings"
          onClick={() => pathname === '/settings' && forgetScroll('/settings')}
        >
          <GearIcon />
          Settings
        </NavLink>
        {/* The everyday lock: unlike the header's panic Lock it flushes
            any capture draft to a note and keeps the session PIN — a tab
            tap must never eat the fact you just typed. */}
        <button
          className="tab-action"
          onClick={() => void timerLock()}
          aria-label="Lock — your draft is saved and the PIN still works"
        >
          <LockIcon />
          Lock
        </button>
      </nav>
    </div>
  )
}
