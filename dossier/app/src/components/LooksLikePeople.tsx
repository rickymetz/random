import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { Person } from '../lib/models'
import { detectNames, type NameCandidate } from '../lib/nameDetect'
import { selectPeople, useVaultStore } from '../store/vaultStore'

/**
 * "Looks like people": after a note is saved, offer the capitalised names
 * in it that point at nobody yet. Each tap either creates that person or
 * links an existing one, rewriting the note to an @mention (the graph
 * edge follows), with an Undo for a few seconds. "Not now" closes the
 * card. Purely local; nothing about declined names is written anywhere —
 * only this in-memory set stops the same "London" coming back note after
 * note until the app is reloaded.
 */
const declinedThisSession = new Set<string>()

const UNDO_MS = 30000

interface Undo {
  prevBody: string
  createdIds: string[]
}

export default function LooksLikePeople({
  noteId,
  person,
  onDone,
  refocus,
}: {
  noteId: string
  /** The dossier the note belongs to — never offered. */
  person: Person
  onDone: () => void
  /** Where keyboard focus goes once the card is gone (the note box). */
  refocus?: () => HTMLElement | null
}) {
  const records = useVaultStore((s) => s.records)
  const linkNamesInNote = useVaultStore((s) => s.linkNamesInNote)
  const updateNote = useVaultStore((s) => s.updateNote)
  const removePeople = useVaultStore((s) => s.removePeople)
  const note = records.get(noteId)
  const body = note?.kind === 'note' ? note.body : ''
  const people = useMemo(() => selectPeople(records), [records])
  const candidates = useMemo(
    () => (body ? detectNames(body, people, person) : []),
    [body, people, person],
  )
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [choosing, setChoosing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [undo, setUndo] = useState<Undo | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(false)
  const visible = candidates.filter(
    (c) => !hidden.has(c.phrase.toLowerCase()) && !declinedThisSession.has(c.phrase.toLowerCase()),
  )
  const empty = visible.length === 0

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Nothing left and nothing to say: hand the space back.
  useEffect(() => {
    if (!busy && !status && empty) onDone()
  }, [busy, status, empty, onDone])

  // Taps must not move focus: the capture bar sits on the tab bar and
  // focus-within hides it, which shifts the bar under a finger mid-tap.
  const keepFocus = (e: React.PointerEvent) => e.preventDefault()
  // Keyboard users whose focused chip just vanished land on the next
  // chip, or back in the note box once the card is done. Runs after
  // commit so the target is no longer disabled.
  const noteFocus = () => {
    wantFocus.current = Boolean(box.current?.contains(document.activeElement))
  }
  useLayoutEffect(() => {
    if (busy || !wantFocus.current) return
    const active = document.activeElement
    if (active && active !== document.body && box.current?.contains(active)) return
    wantFocus.current = false
    const next = box.current?.querySelector<HTMLElement>('button.name') ?? refocus?.() ?? null
    next?.focus()
  })

  if (!note || note.kind !== 'note') return null
  if (empty && !status && !busy) return null

  const flash = (text: string, u: Undo | null = null) => {
    setStatus(text)
    setUndo(u)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setStatus('')
      setUndo(null)
    }, u ? UNDO_MS : 2200)
  }

  const run = async (items: { phrase: string; person?: Person }[]) => {
    if (busy || items.length === 0) return
    noteFocus()
    setBusy(true)
    const prevBody = body
    try {
      const { linked, created } = await linkNamesInNote(
        noteId,
        items.map((c) => ({ phrase: c.phrase, personId: c.person?.id })),
      )
      const linkedExisting = linked.length - created.length
      if (linked.length === 0) {
        flash('Nothing to link')
      } else if (linked.length === 1) {
        flash(created.length ? `Added ${linked[0].displayName} ✓` : `Linked ${linked[0].displayName} ✓`, {
          prevBody,
          createdIds: created.map((p) => p.id),
        })
      } else {
        const parts = []
        if (created.length) parts.push(`added ${created.length}`)
        if (linkedExisting) parts.push(`linked ${linkedExisting}`)
        flash(parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + ' ✓', {
          prevBody,
          createdIds: created.map((p) => p.id),
        })
      }
    } catch {
      flash('Could not save')
    } finally {
      setBusy(false)
    }
  }

  const undoLast = async () => {
    if (!undo || busy) return
    noteFocus()
    setBusy(true)
    const u = undo
    try {
      await updateNote(noteId, u.prevBody)
      if (u.createdIds.length) await removePeople(u.createdIds)
      flash('Undone')
    } catch {
      flash('Could not undo')
    } finally {
      setBusy(false)
    }
  }

  const notNow = () => {
    for (const c of visible) declinedThisSession.add(c.phrase.toLowerCase())
    setHidden(new Set(visible.map((c) => c.phrase.toLowerCase())))
    setChoosing(null)
    // "Not now" means close: don't keep the card up for the Undo window.
    window.clearTimeout(timer.current)
    setStatus('')
    setUndo(null)
  }

  const fresh = visible.filter((c) => !c.existing && !c.options)
  const known = visible.filter((c) => c.existing)
  const allItems = [...fresh, ...known].map((c) => ({ phrase: c.phrase, person: c.existing }))
  const allLabel =
    known.length === 0 ? `Add all ${fresh.length}` : fresh.length === 0 ? `Link all ${known.length}` : `Add & link all ${allItems.length}`

  const chip = (c: NameCandidate) => {
    if (c.options) {
      const open = choosing === c.phrase
      return (
        <li key={c.phrase.toLowerCase()} className={open ? 'choose' : 'ambiguous'}>
          {open ? (
            c.options.map((p) => (
              <button
                key={p.id}
                type="button"
                className="name"
                onPointerDown={keepFocus}
                onClick={() => {
                  setChoosing(null)
                  void run([{ phrase: c.phrase, person: p }])
                }}
                disabled={busy}
                aria-label={`Link ${c.phrase} to ${p.displayName}`}
              >
                <span className="verb">Link</span>
                <span className="text">{c.phrase}</span>
                <span className="who">→ {p.displayName}</span>
              </button>
            ))
          ) : (
            <button
              type="button"
              className="name"
              onPointerDown={keepFocus}
              onClick={() => setChoosing(c.phrase)}
              disabled={busy}
              aria-label={`Link ${c.phrase} — ${c.options.length} people share this name, choose one`}
              aria-expanded={false}
            >
              <span className="verb">Link</span>
              <span className="text">{c.phrase}</span>
              <span className="who">→ {c.options.length} people…</span>
            </button>
          )}
        </li>
      )
    }
    const known = c.existing
    const sameName = known && known.displayName.toLowerCase() === c.phrase.toLowerCase()
    const label = known
      ? sameName
        ? `Link ${known.displayName}`
        : `Link ${c.phrase} to ${known.displayName}`
      : `Add ${c.phrase} as a person and link this note`
    return (
      <li key={c.phrase.toLowerCase()} className={known ? 'known' : 'fresh'}>
        <button
          type="button"
          className="name"
          onPointerDown={keepFocus}
          onClick={() => void run([{ phrase: c.phrase, person: known }])}
          disabled={busy}
          aria-label={label}
          title={label}
        >
          <span className="verb">{known ? 'Link' : 'Add'}</span>
          <span className="text">{c.phrase}</span>
          {known && !sameName && <span className="who">→ {known.displayName}</span>}
        </button>
      </li>
    )
  }

  return (
    <div ref={box} className="looks-like" role="group" aria-label="Looks like people">
      <div className="looks-like-head">
        <span className="looks-like-title">{visible.length ? 'Looks like people' : ''}</span>
        <span className="hint saved" role="status">
          {status}
        </span>
        {undo && (
          <button type="button" className="quiet undo" onPointerDown={keepFocus} onClick={() => void undoLast()} disabled={busy}>
            Undo
          </button>
        )}
        {allItems.length > 1 && (
          <button type="button" className="quiet all" onPointerDown={keepFocus} onClick={() => void run(allItems)} disabled={busy}>
            {allLabel}
          </button>
        )}
        {visible.length > 0 && (
          <button
            type="button"
            className="quiet not-now"
            onPointerDown={keepFocus}
            onClick={() => {
              noteFocus()
              notNow()
            }}
            disabled={busy}
            aria-label="Not now — these aren't people I want to add"
          >
            Not now
          </button>
        )}
      </div>
      {visible.length > 0 && (
        <ul className="looks-like-chips" role="list">
          {visible.map(chip)}
        </ul>
      )}
    </div>
  )
}
