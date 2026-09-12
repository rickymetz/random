import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { matchContacts, parseContacts, type ContactDraft, type ImportedContact } from '../lib/contacts'
import { selectPeople, useVaultStore } from '../store/vaultStore'

/**
 * Contacts import (§4.1 at scale): a .vcf/.csv exported from the phone's
 * contacts app, or the browser's Contact Picker where it exists. The
 * file is read on this device and never leaves it; each contact is a
 * checkbox, people already here are shown but never duplicated, and an
 * import can be undone for a few seconds.
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
const UNDO_MS = 8000

function pickerAvailable(): ContactsManager | null {
  const nav = navigator as Navigator & { contacts?: ContactsManager }
  return nav.contacts && typeof nav.contacts.select === 'function' ? nav.contacts : null
}

function detailOf(c: ContactDraft): string {
  return [c.jobTitle && c.employer ? `${c.jobTitle}, ${c.employer}` : c.jobTitle || c.employer, c.contact?.email, c.contact?.phone]
    .filter(Boolean)
    .join(' · ')
}

export default function ContactImportPanel({ onClose, id }: { onClose: () => void; id?: string }) {
  const records = useVaultStore((s) => s.records)
  const importPeople = useVaultStore((s) => s.importPeople)
  const removePeople = useVaultStore((s) => s.removePeople)
  const people = useMemo(() => selectPeople(records), [records])
  const [contacts, setContacts] = useState<ImportedContact[] | null>(null)
  const [source, setSource] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ count: number; ids: string[] } | null>(null)
  const [status, setStatus] = useState('')
  const titleId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const picker = useMemo(pickerAvailable, [])

  useEffect(() => {
    firstButton.current?.focus()
    return () => window.clearTimeout(timer.current)
  }, [])

  const load = (drafts: ContactDraft[], label: string) => {
    const matched = matchContacts(drafts, people)
    setContacts(matched)
    setSource(label)
    setChecked(new Set(matched.filter((c) => !c.existing).map((c) => c.key)))
    setFilter('')
    setShown(PAGE)
    setError(matched.length ? null : `No contacts found in ${label}.`)
  }

  const readFile = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const { format, contacts: drafts } = parseContacts(text, file.name)
      if (format === 'unknown') {
        setError('Couldn’t read that file — export a .vcf or .csv from your contacts app and try again.')
        return
      }
      load(drafts, file.name)
    } catch {
      setError('Couldn’t read that file.')
    }
  }

  const pick = async () => {
    if (!picker) return
    setError(null)
    try {
      const picked = await picker.select(['name', 'email', 'tel'], { multiple: true })
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
      if (drafts.length) load(drafts, 'your contacts')
    } catch {
      // Cancelled or denied: nothing to say.
    }
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

  const selectedCount = contacts ? contacts.filter((c) => checked.has(c.key)).length : 0
  const knownCount = contacts ? contacts.filter((c) => c.existing).length : 0

  const toggle = (key: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const setShownAll = (on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      for (const c of visible) {
        if (c.existing) continue
        if (on) next.add(c.key)
        else next.delete(c.key)
      }
      return next
    })

  const runImport = async () => {
    if (!contacts || busy || selectedCount === 0) return
    setBusy(true)
    try {
      const chosen = contacts.filter((c) => checked.has(c.key) && !c.existing)
      const created = await importPeople(chosen.map(({ key: _k, existing: _e, ...d }) => d))
      setDone({ count: created.length, ids: created.map((p) => p.id) })
      setStatus(`Imported ${created.length} ${created.length === 1 ? 'person' : 'people'} ✓`)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setDone((d) => (d ? { ...d, ids: [] } : d)), UNDO_MS)
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

  return (
    <section
      className="batch-panel import-panel"
      id={id}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <h2 className="panel-title" id={titleId}>
        Import contacts
      </h2>
      {!contacts && !done && (
        <>
          <p className="hint">
            Export a .vcf or .csv from your contacts app and choose it here. It is read on this device
            only — nothing is uploaded — and you pick who to keep.
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
              <button type="button" onClick={() => void pick()}>
                Pick from contacts…
              </button>
            )}
            <button type="button" className="quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="hint error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {contacts && !done && (
        <>
          <p className="hint import-summary" role="status">
            {contacts.length} in {source}
            {knownCount > 0 && ` · ${knownCount} already here`}
            {` · ${selectedCount} selected`}
          </p>
          {contacts.length > 8 && (
            <input
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
            <button type="button" className="subtle" onClick={() => setShownAll(true)}>
              Select all{filter.trim() ? ' shown' : ' new'}
            </button>
            <button type="button" className="subtle" onClick={() => setShownAll(false)}>
              None
            </button>
          </div>
          <ul className="import-list" role="list">
            {visible.slice(0, shown).map((c) => (
              <li key={c.key}>
                <label className="inline-check import-row">
                  <input
                    type="checkbox"
                    checked={checked.has(c.key)}
                    disabled={Boolean(c.existing) || busy}
                    onChange={(e) => toggle(c.key, e.target.checked)}
                  />
                  <span className="import-text">
                    <span className="name">{c.displayName}</span>
                    {detailOf(c) && <span className="hint">{detailOf(c)}</span>}
                  </span>
                  {c.existing && (
                    <span className="tag known">
                      already here{c.existing.displayName.toLowerCase() !== c.displayName.toLowerCase() ? ` as ${c.existing.displayName}` : ''}
                    </span>
                  )}
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
          <div className="row">
            <button type="button" className="primary" onClick={() => void runImport()} disabled={busy || selectedCount === 0}>
              {busy ? '…' : `Import ${selectedCount}`}
            </button>
            <button type="button" className="quiet" onClick={() => setContacts(null)} disabled={busy}>
              Choose another file
            </button>
            <button type="button" className="quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
          {status && (
            <p className="hint error" role="alert">
              {status}
            </p>
          )}
        </>
      )}
      {done && (
        <div className="row">
          <span className="hint saved" role="status">
            {status}
          </span>
          {done.ids.length > 0 && (
            <button type="button" className="quiet undo" onClick={() => void undo()} disabled={busy}>
              Undo
            </button>
          )}
          <button type="button" className="primary" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      )}
    </section>
  )
}
