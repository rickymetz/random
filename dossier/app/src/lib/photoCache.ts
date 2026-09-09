/**
 * In-memory object URLs for decrypted photos. Object URLs hold plaintext
 * image data, so the cache is part of the decrypted state: lock() must
 * revoke and drop everything here (§6.1).
 */
import { loadBlob, type UnlockedVault } from './vault'

const urls = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

export async function getPhotoUrl(
  vault: UnlockedVault,
  blobRecordId: string,
  mimeType: string,
): Promise<string | null> {
  const cached = urls.get(blobRecordId)
  if (cached) return cached
  const inFlight = pending.get(blobRecordId)
  if (inFlight) return inFlight
  const load = (async () => {
    const bytes = await loadBlob(vault, blobRecordId)
    if (!bytes) return null
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }))
    urls.set(blobRecordId, url)
    return url
  })().finally(() => pending.delete(blobRecordId))
  pending.set(blobRecordId, load)
  return load
}

export function evictPhoto(blobRecordId: string): void {
  const url = urls.get(blobRecordId)
  if (url) {
    URL.revokeObjectURL(url)
    urls.delete(blobRecordId)
  }
}

/** Called from lock(): plaintext image data must not survive a lock. */
export function clearPhotoCache(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
  pending.clear()
}
