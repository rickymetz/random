/**
 * Module-level caches derived from decrypted data (the graph's remembered
 * layout, "Looks like people" declines, a tab's scroll positions) register
 * a clearer here, and lock() runs them all: §6.1 says lock drops the
 * in-memory store, and that includes what was derived from it.
 */
const clearers = new Set<() => void>()

/** Register a clearer; returns an unregister function. */
export function onLock(fn: () => void): () => void {
  clearers.add(fn)
  return () => clearers.delete(fn)
}

export function clearSessionCaches(): void {
  for (const fn of clearers) fn()
  try {
    sessionStorage.removeItem('graph-filters')
  } catch {
    // Storage may be unavailable (private mode); nothing to clear then.
  }
}
