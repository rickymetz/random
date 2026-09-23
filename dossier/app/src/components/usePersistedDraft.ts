import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DraftSlot } from '../lib/models'
import { useVaultStore } from '../store/vaultStore'

/**
 * Keeps what is being written on disk as it's typed, so a reload can't
 * take it: an update applying itself, iOS closing the app from the
 * switcher, a crash. A reload runs no lock and flushes nothing, so
 * without this the half-written text was simply gone.
 *
 * `text` is what to keep, '' for nothing. It is written after a pause in
 * typing, at once when it empties (a reload in the next breath must not
 * bring back what was just saved or discarded), and at once when the
 * page is hidden, closed, left, or locked.
 *
 * `discard()` forgets the draft now (a Cancel, before the editor goes).
 */
export function usePersistedDraft(personId: string, slot: DraftSlot | undefined, text: string) {
  const persistDraft = useVaultStore((s) => s.persistDraft)
  const registerDraftSaver = useVaultStore((s) => s.registerDraftSaver)
  const textRef = useRef(text)
  textRef.current = text
  const timer = useRef<number | undefined>(undefined)
  const cancel = useCallback(() => {
    if (timer.current === undefined) return false
    window.clearTimeout(timer.current)
    timer.current = undefined
    return true
  }, [])
  const flush = useCallback(
    () => (cancel() ? persistDraft(personId, textRef.current, slot) : Promise.resolve()),
    [cancel, persistDraft, personId, slot],
  )
  useEffect(() => {
    cancel()
    if (!text.trim()) {
      void persistDraft(personId, '', slot)
      return
    }
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      void persistDraft(personId, textRef.current, slot)
    }, 600)
  }, [text, personId, slot, persistDraft, cancel])
  useEffect(() => {
    // Going away is when the last keystrokes matter most: write now,
    // don't wait for the pause.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    const unregister = registerDraftSaver(flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      unregister()
      void flush()
    }
  }, [flush, registerDraftSaver])
  return useMemo(
    () => ({
      discard: () => {
        cancel()
        void persistDraft(personId, '', slot)
      },
    }),
    [cancel, persistDraft, personId, slot],
  )
}
