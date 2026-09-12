import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { parseBatch } from '../lib/batch'
import type { Person, RelationshipType } from '../lib/models'
import {
  selectPeople,
  selectRelationshipTypes,
  selectRelationships,
  useVaultStore,
} from '../store/vaultStore'

/**
 * "Add several" (§4.1 at scale): paste or type a list — one name per
 * line, optionally "Name — relationship" — and create everyone in one
 * write. From a dossier, each new (or existing) person is linked to it
 * with the per-line type or the batch default. Existing names are never
 * duplicated: they're linked instead.
 */
/** Keyboard shortcuts are for keyboards: phones get no "Ctrl+Enter". */
const shortcutHint =
  typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches ? ' Ctrl+Enter adds.' : ''

export default function BatchAddPanel({
  anchor,
  onClose,
  headingLevel = 2,
  id,
}: {
  /** The dossier this list belongs to; undefined on the People page. */
  anchor?: Person
  /** Called on Done/Cancel/Escape; the parent puts focus back on its toggle. */
  onClose: () => void
  /** 2 on the People page (siblings are h2), 3 inside a dossier section. */
  headingLevel?: 2 | 3
  /** For the toggle's aria-controls. */
  id?: string
}) {
  const records = useVaultStore((s) => s.records)
  const addPeople = useVaultStore((s) => s.addPeople)
  const addRelationships = useVaultStore((s) => s.addRelationships)
  const people = useMemo(() => selectPeople(records), [records])
  const types = useMemo(
    () =>
      selectRelationshipTypes(records)
        .filter((t) => t.label !== 'mentioned')
        .sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  const [text, setText] = useState('')
  const [defaultTypeId, setDefaultTypeId] = useState(
    () => types.find((t) => t.label === 'friend')?.id ?? types[0]?.id ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const titleId = useId()
  const hintId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Focus the list on open (not autoFocus: a remount must not steal it).
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])
  // People already linked to this dossier: shown, never linked twice.
  const linkedIds = useMemo(() => {
    if (!anchor) return new Set<string>()
    const ids = new Set<string>()
    for (const r of selectRelationships(records)) {
      if (r.origin === 'mention') continue
      if (r.fromId === anchor.id) ids.add(r.toId)
      if (r.toId === anchor.id) ids.add(r.fromId)
    }
    return ids
  }, [records, anchor])

  const entries = useMemo(
    // The dossier's own person can't be linked to themselves.
    () =>
      parseBatch(text, types, people, Boolean(anchor)).filter(
        (e) => !anchor || e.existing?.id !== anchor.id,
      ),
    [text, types, people, anchor],
  )
  const fresh = entries.filter((e) => !e.existing)
  const toLink = entries.filter((e) => e.existing && !linkedIds.has(e.existing.id))
  const alreadyLinked = entries.filter((e) => e.existing && linkedIds.has(e.existing.id))
  const unknownTypes = entries.filter((e) => e.typeLabel && !e.type).map((e) => e.typeLabel!)
  const defaultType = types.find((t) => t.id === defaultTypeId) ?? types[0]
  const first = anchor?.displayName.split(' ')[0]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || entries.length === 0) return
    setBusy(true)
    setStatus(null)
    try {
      const created = await addPeople(fresh.map((f) => f.name))
      const byName = new Map(created.map((p) => [p.displayName.toLowerCase(), p]))
      let linked = 0
      if (anchor) {
        const edges: { fromId: string; toId: string; typeId: string }[] = []
        for (const entry of entries) {
          const person = entry.existing ?? byName.get(entry.name.toLowerCase())
          const type: RelationshipType | undefined = entry.type ?? defaultType
          if (!person || !type || linkedIds.has(person.id)) continue
          // "June — parent of" reads as June is parent of this person:
          // for one-way types the listed person is the source.
          edges.push(
            type.directed
              ? { fromId: person.id, toId: anchor.id, typeId: type.id }
              : { fromId: anchor.id, toId: person.id, typeId: type.id },
          )
        }
        await addRelationships(edges)
        linked = edges.length
      }
      const parts = [`Added ${created.length} ${created.length === 1 ? 'person' : 'people'}`]
      if (anchor) parts.push(`linked ${linked}`)
      if (alreadyLinked.length) parts.push(`${alreadyLinked.length} already linked`)
      setStatus(`${parts.join(', ')} ✓`)
      setText('')
      // Ready for the next paste; the disabled Add would drop focus.
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch {
      setStatus('Could not add them — try again.')
    } finally {
      setBusy(false)
    }
  }

  const nothingToDo = fresh.length === 0 && (!anchor || toLink.length === 0)
  const label = nothingToDo
    ? 'Add'
    : `Add ${fresh.length}${anchor && toLink.length ? `, link ${toLink.length}` : ''}`

  return (
    <form
      className="batch-panel"
      id={id}
      onSubmit={submit}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {headingLevel === 2 ? (
        <h2 className="panel-title" id={titleId}>
          Add several
        </h2>
      ) : (
        <h3 className="panel-title" id={titleId}>
          Add several
        </h3>
      )}
      <p className="hint" id={hintId}>
        {anchor
          ? `One per line. Add how you know them after a dash — “June Webb — parent of” means June is ${first}'s parent.${shortcutHint}`
          : `One per line, or separated by commas.${shortcutHint}`}
      </p>
      <textarea
        ref={textareaRef}
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (status) setStatus(null)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder={
          anchor
            ? 'Sam Okafor — coworker\nPriya Raman\nJune Webb — parent of'
            : 'Sam Okafor\nPriya Raman, Theo Martins'
        }
        aria-label="Names, one per line"
        aria-describedby={hintId}
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
      />
      {anchor && types.length > 0 && (
        <label className="batch-default">
          <span>Link to {first} as</span>
          <select value={defaultType?.id ?? ''} onChange={(e) => setDefaultTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {entries.length > 0 && (
        <ul
          className="batch-preview"
          aria-label="People to add"
          tabIndex={entries.length > 8 ? 0 : undefined}
        >
          {entries.map((e) => {
            const linkedAlready = e.existing ? linkedIds.has(e.existing.id) : false
            return (
              <li key={e.name.toLowerCase()}>
                <span className="name">{e.existing?.displayName ?? e.name}</span>
                {!e.existing ? (
                  <span className="tag">new</span>
                ) : linkedAlready ? (
                  <span className="tag known">already linked</span>
                ) : (
                  <span className="tag known">
                    already here{anchor ? ', will link' : ', skipped'}
                  </span>
                )}
                {anchor && !linkedAlready && (
                  <span className="hint">
                    {e.type
                      ? e.type.label
                      : e.typeLabel
                        ? `${e.typeLabel} isn't a type — using ${defaultType?.label ?? ''}`
                        : (defaultType?.label ?? '')}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {anchor && unknownTypes.length > 0 && (
        <p className="hint">
          Unknown relationship{unknownTypes.length > 1 ? 's' : ''}: {unknownTypes.join(', ')} —
          those lines get the default. New types are created from the relationship form.
        </p>
      )}
      <div className="row">
        <button
          type="submit"
          className="primary"
          disabled={busy || entries.length === 0 || nothingToDo}
        >
          {busy ? 'Adding…' : label}
        </button>
        <button type="button" className="quiet" onClick={onClose} disabled={busy}>
          {status ? 'Done' : 'Cancel'}
        </button>
        <span className="hint status-slot" role="status">
          {status}
        </span>
      </div>
    </form>
  )
}
