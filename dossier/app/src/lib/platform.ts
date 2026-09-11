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
