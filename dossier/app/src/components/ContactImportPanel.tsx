import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { matchContacts, parseContacts, type ContactDraft, type ImportedContact } from '../lib/contacts'
import { isIos } from '../lib/platform'
import { selectPeople, useVaultStore } from '../store/vaultStore'

/**
 * Contacts import (§4.1 at scale): a .vcf/.csv exported from the phone's
 * contacts app, or the browser's Contact Picker where it exists. The
 * file is read on this device and never leaves it; each contact is a
 * checkbox (a big file starts with nothing selected — this app is for
 * the people you meet, not the whole address book), people already here
 * are shown but never duplicated, contact notes come along only on
 * request, and an import can be undone until the panel is closed.
 */

interface PickedContact {
  name?: string[]
  email?: string[]
  tel?: string[]
}
interface ContactsManager {
  select(props: string[], opts?: { multiple?: boolean }): Promise<PickedContact[]>
  getProperties?: () => Promise<string[]>
}

const PAGE = 100
/** Above this many contacts a file starts unselected: pick, don't dump. */
const PRESELECT_MAX = 25

function pickerAvailable(): ContactsManager | null {
  const nav = navigator as Navigator & { contacts?: ContactsManager }
  return nav.contacts && typeof nav.contacts.select === 'function' ? nav.contacts : null
}

/** Decode a contacts file: UTF-16 by BOM, strict UTF-8, else Windows-1252 (Outlook desktop). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const b = new Uint8Array(buf)
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(b)
    } catch {
      return new TextDecoder().decode(b)
    }
  }
}

function detailOf(c: ContactDraft): string {
  return [c.jobTitle && c.employer ? `${c.jobTitle}, ${c.employer}` : c.jobTitle || c.employer, c.contact?.email, c.contact?.phone]
    .filter(Boolean)
    .join(' · ')
}

type View = 'pick' | 'list' | 'done'

export default function ContactImportPanel({ onClose, id }: { onClose: () => void; id?: string }) {
  const importPeople = useVaultStore((s) => s.importPeople)
  const removePeople = useVaultStore((s) => s.removePeople)
  const [contacts, setContacts] = useState<ImportedContact[] | null>(null)
  const [source, setSource] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [withNotes, setWithNotes] = useState(false)
  const [filter, setFilter] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ count: number; ids: string[] } | null>(null)
  const [status, setStatus] = useState('')
  const titleId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const listHead = useRef<HTMLButtonElement>(null)
  const doneButton = useRef<HTMLButtonElement>(null)
  const picker = useMemo(pickerAvailable, [])
  const ios = useMemo(isIos, [])
  const view: View = done ? 'done' : contacts ? 'list' : 'pick'

  // Each view change moves focus to its first control, so keyboard and
  // switch users are never dropped onto <body> when a button unmounts.
  useEffect(() => {
    const target =
      view === 'pick' ? firstButton.current : view === 'list' ? (filterRef.current ?? listHead.current) : doneButton.current
    target?.focus()
  }, [view])

  const load = (drafts: ContactDraft[], label: string, preselect: boolean) => {
    // Match against the vault as it is now, not as it was when the panel opened.
    const matched = matchContacts(drafts, selectPeople(useVaultStore.getState().records))
    if (matched.length === 0) {
      setError(`No contacts found in ${label}.`)
      return
    }
    const fresh = matched.filter((c) => !c.existing || c.conflict)
    setContacts(matched)
    setSource(label)
    setChecked(new Set(preselect || fresh.length <= PRESELECT_MAX ? fresh.filter((c) => !c.conflict).map((c) => c.key) : []))
    setWithNotes(false)
    setFilter('')
    setShown(PAGE)
    setError(null)
    setStatus('')
  }

  const readFile = async (file: File) => {
    setError(null)
    let parsed: ReturnType<typeof parseContacts>
    try {
      parsed = parseContacts(await readText(file), file.name)
    } catch {
      setError('Couldn’t read that file.')
      return
    }
    if (parsed.format === 'unknown') {
      setError('Couldn’t read that file — it needs to be a .vcf or .csv from your contacts app.')
      return
    }
    load(parsed.contacts, file.name, false)
  }

  const pick = async () => {
    if (!picker || picking) return
    setError(null)
    setPicking(true)
    let picked: PickedContact[]
    try {
      picked = await picker.select(['name', 'email', 'tel'], { multiple: true })
    } catch (err) {
      // Cancelling resolves with []; a rejection is a real problem.
      if ((err as DOMException)?.name !== 'InvalidStateError') {
        setError('Couldn’t open your contacts — choose a file instead.')
      }
      return
    } finally {
      setPicking(false)
    }
    const drafts: ContactDraft[] = picked
      .map((c) => {
        const displayName = c.name?.[0]?.trim() || c.email?.[0]?.trim() || c.tel?.[0]?.trim() || ''
        const email = c.email?.[0]?.trim().toLowerCase()
        const phone = c.tel?.[0]?.trim()
        const d: ContactDraft = { displayName }
        if (email || phone) d.contact = { ...(phone ? { phone } : {}), ...(email ? { email } : {}) }
        return d
      })
      .filter((d) => d.displayName)
    // Hand-picked in the phone's own UI: keep them all selected.
    if (drafts.length) load(drafts, 'your contacts', true)
  }

  const visible = useMemo(() => {
    if (!contacts) return []
    const q = filter.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) =>
      [c.displayName, c.employer, c.jobTitle, c.contact?.email, c.contact?.phone, ...(c.nicknames ?? [])]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [contacts, filter])
  const page = visible.slice(0, shown)

  const selectable = (c: ImportedContact) => !c.existing || Boolean(c.conflict)
  const selectedCount = contacts ? contacts.filter((c) => checked.has(c.key)).length : 0
  const knownCount = contacts ? contacts.filter((c) => c.existing && !c.conflict).length : 0
  const notesCount = contacts ? contacts.filter((c) => c.note && checked.has(c.key)).length : 0
  const filtering = filter.trim() !== ''

  const toggle = (key: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const setPageAll = (on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      for (const c of page) {
        if (!selectable(c)) continue
        if (on) next.add(c.key)
        else next.delete(c.key)
      }
      return next
    })

  const runImport = async () => {
    if (!contacts || busy || selectedCount === 0) return
    setBusy(true)
    try {
      const chosen = contacts.filter((c) => checked.has(c.key) && selectable(c))
      const created = await importPeople(
        chosen.map(({ key: _k, existing: _e, conflict: _c, note, ...d }) => (withNotes && note ? { ...d, note } : d)),
      )
      setDone({ count: created.length, ids: created.map((p) => p.id) })
      setStatus(`Imported ${created.length} ${created.length === 1 ? 'person' : 'people'} ✓`)
    } catch {
      setStatus('Could not save — check storage and try again.')
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!done?.ids.length || busy) return
    setBusy(true)
    try {
      await removePeople(done.ids)
      setDone({ count: 0, ids: [] })
      setStatus('Import undone')
    } catch {
      setStatus('Could not undo')
    } finally {
      setBusy(false)
    }
  }

  const rowTag = (c: ImportedContact) => {
    if (!c.existing) return null
    const same = c.existing.displayName.toLowerCase() === c.displayName.toLowerCase()
    const who = same ? '' : ` as ${c.existing.displayName}`
    return <span className="tag known">{c.conflict ? `same name as ${c.existing.displayName}` : `already here${who}`}</span>
  }

  return (
    <section
      className="batch-panel import-panel"
      id={id}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        if (busy) return
        // Escape in a non-empty filter clears it (what a search box does); a second Escape closes.
        if (e.target === filterRef.current && filter) {
          e.preventDefault()
          setFilter('')
          setShown(PAGE)
          return
        }
        onClose()
      }}
    >
      <h2 className="panel-title" id={titleId}>
        Import contacts
      </h2>
      {view === 'pick' && (
        <>
          <p className="hint">
            {ios
              ? 'In Contacts, open a person, tap Share Contact, then Save to Files — choose that file here. For many people at once, export a vCard from iCloud.com on a computer.'
              : picker
                ? 'Pick people straight from your contacts, or choose a .vcf or .csv exported from a contacts app.'
                : 'Export a .vcf or .csv from your contacts app (Google Contacts, Outlook, or the Contacts app on a computer) and choose it here.'}{' '}
            The file is read on this device only — nothing is uploaded — and you pick who to keep: name,
            nickname, job, company, city, birthday, phone and e-mail.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".vcf,.vcard,.csv,.txt,text/vcard,text/x-vcard,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
              e.target.value = ''
            }}
          />
          <div className="row">
            <button ref={firstButton} type="button" className="primary" onClick={() => fileRef.current?.click()}>
              Choose file…
            </button>
            {picker && (
              <button type="button" onClick={() => void pick()} disabled={picking}>
                {picking ? '…' : 'Pick from contacts…'}
              </button>
            )}
            <button type="button" className="quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
          {!picker && !ios && (
            <p className="hint">Picking straight from Contacts isn’t available in this browser.</p>
          )}
          {error && (
            <p className="hint error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {view === 'list' && contacts && (
        <>
          <p className="hint import-summary">
            {contacts.length} in {source}
            {knownCount > 0 && ` · ${knownCount} already here`}
            {` · ${selectedCount} selected`}
          </p>
          {contacts.length > PRESELECT_MAX && selectedCount === 0 && (
            <p className="hint">Search for the people you want to keep, or select them below.</p>
          )}
          {contacts.length > 8 && (
            <input
              ref={filterRef}
              type="search"
              className="import-filter"
              placeholder="Filter by name, e-mail, company…"
              aria-label="Filter contacts"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setShown(PAGE)
              }}
            />
          )}
          <div className="row import-bulk">
            <button ref={listHead} type="button" className="subtle" onClick={() => setPageAll(true)}>
              {filtering ? 'Select all shown' : 'Select all new'}
            </button>
            <button type="button" className="subtle" onClick={() => setPageAll(false)}>
              {filtering ? 'None shown' : 'None'}
            </button>
          </div>
          <ul className="import-list" role="list">
            {page.map((c) => (
              <li key={c.key}>
                <label className="inline-check import-row">
                  <input
                    type="checkbox"
                    checked={checked.has(c.key)}
                    disabled={!selectable(c) || busy}
                    onChange={(e) => toggle(c.key, e.target.checked)}
                  />
                  <span className="import-text">
                    <span className="name">{c.displayName}</span>
                    {detailOf(c) && <span className="hint">{detailOf(c)}</span>}
                    {(rowTag(c) || c.note) && (
                      <span className="import-tags">
                        {rowTag(c)}
                        {c.note && <span className="tag">has a note</span>}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
            {visible.length > shown && (
              <li className="list-more">
                <button type="button" className="subtle" onClick={() => setShown((n) => n + PAGE)}>
                  Show more ({visible.length - shown} remaining)
                </button>
              </li>
            )}
            {visible.length === 0 && <li className="hint">No contacts match.</li>}
          </ul>
          {contacts.some((c) => c.note) && (
            <label className="inline-check">
              <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} disabled={busy} />
              Also keep each contact’s Notes as their first note
              {notesCount > 0 ? ` (${notesCount} selected ${notesCount === 1 ? 'has' : 'have'} one)` : ''}
            </label>
          )}
          <div className="row">
            <button type="button" className="primary" onClick={() => void runImport()} disabled={busy || selectedCount === 0}>
              {busy ? '…' : `Import ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}`}
            </button>
            <button type="button" className="quiet" onClick={() => setContacts(null)} disabled={busy}>
              Other file
            </button>
            <button type="button" className="quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
      {view === 'done' && done && (
        <div className="row">
          {done.ids.length > 0 && (
            <button type="button" className="quiet undo" onClick={() => void undo()} disabled={busy}>
              Undo
            </button>
          )}
          <button ref={doneButton} type="button" className="primary" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      )}
      {/* One live region for the whole panel, mounted from the start so
          announcements land; errors use the alert above. */}
      <p className={`hint status-slot${/Could not/.test(status) ? ' error' : ' saved'}`} role="status">
        {status}
      </p>
    </section>
  )
}
