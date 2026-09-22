/**
 * Asking for a new version now, rather than waiting for the hourly check.
 *
 * An installed copy updates itself: the service worker is registered in
 * `autoUpdate` mode, main.tsx asks the server once an hour, and when a
 * new build activates the page reloads onto it. What it could not do is
 * answer "am I on the latest?" on demand, so the only sure way to get a
 * fix that had just shipped was to delete the app and add it again.
 */

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
