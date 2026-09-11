/**
 * Platform/durability signals (REQUIREMENTS.md §7): request persistent
 * storage and keep the answer around so Settings can surface it — on iOS
 * especially, "not persisted" means the encrypted-export habit is the
 * only durability story.
 */

export interface StorageStatus {
  persisted: boolean | null
  usageBytes: number | null
  quotaBytes: number | null
}

const status: StorageStatus = { persisted: null, usageBytes: null, quotaBytes: null }

export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) {
      status.persisted = await navigator.storage.persist()
    }
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate()
      status.usageBytes = estimate.usage ?? null
      status.quotaBytes = estimate.quota ?? null
    }
  } catch {
    // Leave nulls; Settings renders "unknown".
  }
}

export function getStorageStatus(): StorageStatus {
  return { ...status }
}

/**
 * PIN fields mask via CSS -webkit-text-security to keep the iOS numeric
 * keypad; Firefox lacks the property, so fall back to type=password
 * there rather than render the PIN in cleartext.
 */
export const PIN_MASK_SUPPORTED =
  typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc') === true

/** iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/**
 * Running in a Safari tab on iOS rather than from the Home Screen. The
 * two keep SEPARATE storage: a vault created in the tab does not exist
 * inside the installed app (and vice versa), and notifications only work
 * from the Home Screen app — so the install hint matters here.
 */
export function isIosBrowserTab(): boolean {
  if (!isIos()) return false
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return false
  if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) {
    return false
  }
  return true
}
