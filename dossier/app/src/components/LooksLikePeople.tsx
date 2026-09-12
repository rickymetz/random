import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { Person } from '../lib/models'
import { detectNames, type NameCandidate } from '../lib/nameDetect'
import { selectPeople, useVaultStore } from '../store/vaultStore'

/**
 * "Looks like people": after a note is saved, offer the capitalised names
 * in it that point at nobody yet. Each tap either creates that person or
 * links an existing one, rewriting the note to an @mention (the graph
 * edge follows). Purely local; dismissing is one tap and nothing is
 * remembered about what was declined.
 */
export default function LooksLikePeople({
  noteId,
  person,
  onDone,
}: {
  noteId: string
  /** The dossier the note belongs to — never offered. */
  person: Person
  onDone: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const linkNamesInNote = useVaultStore((s) => s.linkNamesInNote)
  const note = records.get(noteId)
  const body = note?.kind === 'note' ? note.body : ''
  const people = useMemo(() => selectPeople(records), [records])
  const candidates = useMemo(
    () => (body ? detectNames(body, people, person) : []),
    [body, people, person],
  )
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  // Taps must not move focus: the capture bar sits on the tab bar and
  // focus-within hides it, which shifts the bar under a finger mid-tap.
  const keepFocus = (e: React.PointerEvent) => e.preventDefault()
  // Keyboard users whose focused chip just vanished land on the next
  // chip, or back in the note box once the card is done.
  const restoreFocus = () =>
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body) return
      const next =
        box.current?.querySelector<HTMLElement>('button.name') ??
        document.querySelector<HTMLElement>('.capture-bar textarea')
      next?.focus()
    })
  const visible = candidates.filter((c) => !dismissed.has(c.phrase.toLowerCase()))

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Nothing left and nothing to say: hand the space back.
  useEffect(() => {
    if (!busy && !status && visible.length === 0) onDone()
  }, [busy, status, visible.length, onDone])

  if (!note || note.kind !== 'note') return null
  if (visible.length === 0 && !status) return null

  const flash = (text: string) => {
    setStatus(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus(''), 2200)
  }

  const run = async (items: NameCandidate[]) => {
    if (busy || items.length === 0) return
    setBusy(true)
    try {
      const linked = await linkNamesInNote(
        noteId,
        items.map((c) => ({ phrase: c.phrase, personId: c.existing?.id })),
      )
      const added = items.filter((c) => !c.existing).length
      const linkedExisting = linked.length - Math.min(added, linked.length)
      if (linked.length === 0) {
        flash('Nothing to link')
      } else if (items.length === 1) {
        flash(items[0].existing ? `Linked ${linked[0].displayName} ✓` : `Added ${linked[0].displayName} ✓`)
      } else {
        const parts = []
        if (added) parts.push(`added ${added}`)
        if (linkedExisting) parts.push(`linked ${linkedExisting}`)
        flash(parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + ' ✓')
      }
    } finally {
      setBusy(false)
      restoreFocus()
    }
  }

  const dismiss = (c: NameCandidate) => {
    setDismissed((prev) => new Set(prev).add(c.phrase.toLowerCase()))
    restoreFocus()
  }

  const allNew = visible.every((c) => !c.existing)
  const allKnown = visible.every((c) => c.existing)
  const allLabel = allNew ? 'Add all' : allKnown ? 'Link all' : 'Add & link all'

  return (
    <div ref={box} className="looks-like" role="group" aria-label="Looks like people">
      <span className="looks-like-title">
        {visible.length ? 'Looks like people' : ''}
        {status && (
          <span className="hint saved" role="status">
            {status}
          </span>
        )}
      </span>
      {visible.length > 0 && (
        <ul>
          {visible.map((c) => {
            const known = c.existing
            const sameName = known && known.displayName.toLowerCase() === c.phrase.toLowerCase()
            const label = known
              ? sameName
                ? `Link ${known.displayName}`
                : `Link ${c.phrase} to ${known.displayName}`
              : `Add ${c.phrase} as a person`
            return (
              <li key={c.phrase.toLowerCase()} className={known ? 'known' : 'fresh'}>
                <button
                  type="button"
                  className="name"
                  onPointerDown={keepFocus}
                  onClick={() => void run([c])}
                  disabled={busy}
                  aria-label={label}
                  title={label}
                >
                  <span className="mark" aria-hidden="true">
                    {known ? '@' : '+'}
                  </span>
                  <span className="text">{c.phrase}</span>
                  {known && !sameName && (
                    <span className="who" aria-hidden="true">
                      → {known.displayName}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="subtle icon skip"
                  onPointerDown={keepFocus}
                  onClick={() => dismiss(c)}
                  disabled={busy}
                  aria-label={`Not a person: ${c.phrase}`}
                  title="Not a person"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {visible.length > 1 && (
        <button type="button" className="quiet all" onPointerDown={keepFocus} onClick={() => void run(visible)} disabled={busy}>
          {allLabel}
        </button>
      )}
      {visible.length > 0 && (
        <button
          type="button"
          className="subtle icon dismiss"
          onPointerDown={keepFocus}
          onClick={() => {
            onDone()
            restoreFocus()
          }}
          disabled={busy}
          aria-label="Dismiss suggestions"
          title="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  )
}
