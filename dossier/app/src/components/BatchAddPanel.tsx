import { useMemo, useState } from 'react'
import { parseBatch } from '../lib/batch'
import type { Person, RelationshipType } from '../lib/models'
import { selectPeople, selectRelationshipTypes, useVaultStore } from '../store/vaultStore'

/**
 * "Add several" (§4.1 at scale): paste or type a list — one name per
 * line, optionally "Name — relationship" — and create everyone in one
 * write. From a dossier, each new (or existing) person is linked to it
 * with the per-line type or the batch default. Existing names are never
 * duplicated: they're linked instead.
 */
export default function BatchAddPanel({
  anchor,
  onClose,
}: {
  /** The dossier this list belongs to; undefined on the People page. */
  anchor?: Person
  onClose: () => void
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

  const entries = useMemo(
    // The dossier's own person can't be linked to themselves.
    () => parseBatch(text, types, people).filter((e) => !anchor || e.existing?.id !== anchor.id),
    [text, types, people, anchor?.id],
  )
  const fresh = entries.filter((e) => !e.existing)
  const known = entries.filter((e) => e.existing)
  const unknownTypes = entries.filter((e) => e.typeLabel && !e.type).map((e) => e.typeLabel!)
  const defaultType = types.find((t) => t.id === defaultTypeId)
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
          if (!person || !type) continue
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
      setStatus(`${parts.join(', ')} ✓`)
      setText('')
    } catch {
      setStatus('Could not add them — try again.')
    } finally {
      setBusy(false)
    }
  }

  const label = entries.length === 0
    ? 'Add'
    : `Add ${fresh.length}${known.length ? ` · link ${known.length}` : ''}`

  return (
    <form className="batch-panel" onSubmit={submit} aria-label="Add several people">
      <p className="panel-title">Add several</p>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          anchor
            ? 'One per line — add how you know them after a dash:\nSam Okafor — coworker\nPriya Raman\nJune Webb — parent of'
            : 'One per line, or separated by commas:\nSam Okafor\nPriya Raman, Theo Martins'
        }
        aria-label="Names, one per line"
        autoFocus
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
      />
      {anchor && types.length > 0 && (
        <label className="batch-default">
          <span>Link to {first} as</span>
          <select
            value={defaultTypeId}
            onChange={(e) => setDefaultTypeId(e.target.value)}
            aria-label="Relationship for people without one"
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="hint">unless a line says otherwise</span>
        </label>
      )}
      {entries.length > 0 && (
        <ul className="batch-preview" aria-label="People to add">
          {entries.map((e) => (
            <li key={e.name.toLowerCase()}>
              <span className="name">{e.existing?.displayName ?? e.name}</span>
              {e.existing ? (
                <span className="tag known">already here{anchor ? ' — will link' : ' — skipped'}</span>
              ) : (
                <span className="tag">new</span>
              )}
              {anchor && (
                <span className="hint">
                  {e.type
                    ? e.type.label
                    : e.typeLabel
                      ? `“${e.typeLabel}” isn't a type → ${defaultType?.label ?? ''}`
                      : (defaultType?.label ?? '')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {unknownTypes.length > 0 && (
        <p className="hint">
          Unknown relationship{unknownTypes.length > 1 ? 's' : ''}: {unknownTypes.join(', ')} —
          those lines get the default. Create new types from the relationship form.
        </p>
      )}
      <div className="row">
        <button
          type="submit"
          className="primary"
          disabled={busy || entries.length === 0 || (!anchor && fresh.length === 0)}
        >
          {busy ? 'Adding…' : label}
        </button>
        <button type="button" className="subtle" onClick={onClose} disabled={busy}>
          {status ? 'Done' : 'Cancel'}
        </button>
        <span className="hint status-slot" role="status">
          {status}
        </span>
      </div>
    </form>
  )
}
