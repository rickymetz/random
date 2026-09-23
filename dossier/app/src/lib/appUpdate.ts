/**
 * New versions, and when to take them.
 *
 * main.tsx asks the server for a new build once an hour. A build that
 * arrives waits (`prompt` mode) instead of reloading the page on the
 * spot: the old `autoUpdate` reload landed wherever you were, locked you
 * out mid-sentence and took a half-written note with it. App.tsx takes a
 * waiting build at the next moment nothing is in use — when the app
 * locks, or on the unlock screen before anything is typed — and
 * Settings → Updates takes it at once when asked.
 */

type Apply = (reloadPage?: boolean) => Promise<void>
let applyFn: Apply | null = null
let ready = false
/**
 * Until when an explicit "update now" stands. It must expire: if the
 * build it was waiting for fails to install, the next one — found hours
 * later by the hourly check, mid-sentence — must wait its turn like any
 * other, not reload the page on the strength of an old tap.
 */
let wantedUntil = 0
const WANT_FOR_MS = 60_000
const listeners = new Set<() => void>()

/** main.tsx hands over the function that tells the waiting build to take over. */
export function wireUpdate(apply: Apply): void {
  applyFn = apply
}

/** A new build has installed and is waiting to take over. */
export function markUpdateReady(): void {
  ready = true
  if (Date.now() < wantedUntil) void applyUpdate()
  for (const l of listeners) l()
}

export function isUpdateReady(): boolean {
  return ready
}

export function onUpdateReady(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Take the new build: now if it's waiting, else as soon as it has
 * installed. The page reloads onto it (and so opens locked).
 */
export async function applyUpdate(): Promise<void> {
  if (!ready || !applyFn) {
    wantedUntil = Date.now() + WANT_FOR_MS
    return
  }
  wantedUntil = 0
  // Reload when the new build takes over. The plugin does this only for
  // an update it counts as its own; one found by `registration.update()`
  // (the hourly check, the Settings button) is "external" to it, and the
  // page would otherwise stay on the old build under the new worker.
  if (!reloadArmed && navigator.serviceWorker) {
    reloadArmed = true
    // For an update it does count as its own (one found waiting at
    // start-up) the plugin reloads too: let it go first, and only reload
    // if nothing has started leaving — one reopen, not two.
    let leaving = false
    window.addEventListener('beforeunload', () => (leaving = true), { once: true })
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.setTimeout(() => leaving || location.reload(), 0),
      { once: true },
    )
  }
  await applyFn(true)
}
let reloadArmed = false

export type UpdateCheck =
  /** The server has nothing newer than what is running. */
  | 'current'
  /** A newer build was found and is installing; the page will reopen on it. */
  | 'updating'
  /** The server could not be reached. */
  | 'offline'
  /** No service worker here (development, or a browser without them). */
  | 'unavailable'

export async function checkForUpdate(): Promise<UpdateCheck> {
  const container = navigator.serviceWorker
  if (!container) return 'unavailable'
  const registration = await container.getRegistration()
  if (!registration) return 'unavailable'
  // A device that knows it's offline must not report "latest": the
  // check can be answered from somewhere other than the server.
  if (navigator.onLine === false) return 'offline'
  try {
    // Fetches the worker script past the HTTP cache and, if it differs
    // by a byte, starts installing it before resolving.
    await registration.update()
  } catch {
    return 'offline'
  }
  return registration.installing || registration.waiting ? 'updating' : 'current'
}

/** "0.1.0 (a1b2c3d), built 22 Sep 2026" — what this copy is. */
export function buildLabel(version: string, id: string, time: string, locale?: string): string {
  const when = new Date(time)
  const date = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${version} (${id})${date ? `, built ${date}` : ''}`
}
