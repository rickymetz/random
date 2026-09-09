/**
 * In-memory object URLs for decrypted photos. Object URLs hold plaintext
 * image data, so the cache is part of the decrypted state: lock() must
 * revoke and drop everything here (§6.1). A generation counter makes the
 * clear final — a decrypt that was in flight when the lock happened
 * revokes its own URL instead of re-populating the cleared cache. The
 * cache is also bounded (LRU) so a long session doesn't retain every
 * photo ever scrolled past.
 */
import { loadBlob, type UnlockedVault } from './vault'

const MAX_CACHED_URLS = 64

const urls = new Map<string, string>() // Map preserves insertion order → LRU
const pending = new Map<string, Promise<string | null>>()
let generation = 0

function touch(key: string, url: string): void {
  urls.delete(key)
  urls.set(key, url)
  if (urls.size > MAX_CACHED_URLS) {
    const oldest = urls.keys().next().value as string
    const evicted = urls.get(oldest)
    urls.delete(oldest)
    if (evicted) URL.revokeObjectURL(evicted)
  }
}

/** Synchronous cache peek — lets components render without a flash. */
export function peekPhotoUrl(blobRecordId: string, mimeType: string): string | null {
  return urls.get(`${blobRecordId}:${mimeType}`) ?? null
}

export async function getPhotoUrl(
  vault: UnlockedVault,
  blobRecordId: string,
  mimeType: string,
): Promise<string | null> {
  const key = `${blobRecordId}:${mimeType}`
  const cached = urls.get(key)
  if (cached) {
    touch(key, cached)
    return cached
  }
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const startGeneration = generation
  const load = (async () => {
    const bytes = await loadBlob(vault, blobRecordId)
    if (!bytes) return null
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }))
    if (generation !== startGeneration) {
      // A lock happened while we were decrypting: the cache was cleared
      // and must stay cleared. Destroy the URL instead of caching it.
      URL.revokeObjectURL(url)
      return null
    }
    touch(key, url)
    return url
  })().finally(() => pending.delete(key))
  pending.set(key, load)
  return load
}

export function evictPhoto(blobRecordId: string): void {
  for (const [key, url] of urls) {
    if (key.startsWith(`${blobRecordId}:`)) {
      URL.revokeObjectURL(url)
      urls.delete(key)
    }
  }
}

/** Called from lock(): plaintext image data must not survive a lock. */
export function clearPhotoCache(): void {
  generation += 1
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
  pending.clear()
}
