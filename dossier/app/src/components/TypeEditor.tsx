/**
 * The relationship vocabulary (REQUIREMENTS.md §8.2) — Settings.
 *
 * Ties point at a type by id, so renaming one lands on every tie at
 * once. A type in use retires rather than deletes: the ties that carry
 * it keep drawing, it just stops being offered for new ones. A type
 * nothing uses is deleted outright.
 */
import { useMemo, useState } from 'react'
import { TYPE_FAMILIES, type RelationshipType, type TypeFamily } from '../lib/models'
import { familyOf } from '../lib/relationships'
import { selectRelationships, selectRelationshipTypes, useVaultStore } from '../store/vaultStore'

/** The four hue families, by id, so a family reads as a word. */
const FAMILY_LABELS = Object.fromEntries(
  TYPE_FAMILIES.map((f) => [f.id, f.label]),
) as Record<TypeFamily, string>

export default function TypeEditor() {
  const records = useVaultStore((s) => s.records)
  const updateType = useVaultStore((s) => s.updateRelationshipType)
  const retireType = useVaultStore((s) => s.retireRelationshipType)
  const restoreType = useVaultStore((s) => s.restoreRelationshipType)
  const addType = useVaultStore((s) => s.addRelationshipType)

  const all = useMemo(() => selectRelationshipTypes(records), [records])
  // "mentioned" is the note parser's own edge, not vocabulary anyone picks.
  const vocabulary = useMemo(() => all.filter((t) => t.label !== 'mentioned'), [all])
  const active = useMemo(
    () => vocabulary.filter((t) => !t.retired).sort((a, b) => a.label.localeCompare(b.label)),
    [vocabulary],
  )
  const retired = useMemo(
    () => vocabulary.filter((t) => t.retired).sort((a, b) => a.label.localeCompare(b.label)),
    [vocabulary],
  )
  const useCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of selectRelationships(records)) {
      counts.set(r.typeId, (counts.get(r.typeId) ?? 0) + 1)
    }
    return counts
  }, [records])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [family, setFamily] = useState<TypeFamily>('other')
  const [msg, setMsg] = useState<string | null>(null)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) return
    if (all.some((t) => t.label.toLowerCase() === trimmed.toLowerCase())) {
      return setMsg('That word is already in the list.')
    }
    setMsg(null)
    await addType(trimmed, '#9a6fd0', false, family)
    setLabel('')
    setAdding(false)
  }

  return (
    <section>
      <h2>Kinds of relationship</h2>
      <p className="hint">
        The words you link people with. Renaming one changes it everywhere it’s used.
      </p>
      <ul className="field-defs">
        {active.map((type) => {
          const n = useCounts.get(type.id) ?? 0
          return (
            <li key={type.id}>
              {editingId === type.id ? (
                <TypeRowEditor
                  type={type}
                  inUse={n}
                  onDone={() => setEditingId(null)}
                  onSave={async (next) => {
                    const result = await updateType(next)
                    if (result === 'name-taken') return 'That word is already in the list.'
                    setEditingId(null)
                    return null
                  }}
                  onRetire={async () => {
                    setEditingId(null)
                    await retireType(type.id)
                  }}
                />
              ) : (
                <div className="field-def-row">
                  <button
                    className="field-def-name"
                    onClick={() => setEditingId(type.id)}
                    aria-label={`Edit ${type.label}`}
                  >
                    <span className="type-swatch-name">
                      <span
                        className="type-swatch"
                        style={{ '--chip-color': type.color } as React.CSSProperties}
                        aria-hidden="true"
                      />
                      {type.label}
                    </span>
                    <span className="hint desc">
                      {FAMILY_LABELS[familyOf(type)]}
                      {n > 0 ? ` · on ${n} ${n === 1 ? 'tie' : 'ties'}` : ' · unused'}
                    </span>
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {adding ? (
        <form className="add-field" onSubmit={add}>
          <label>
            Word
            <input
              value={label}
              autoFocus
              placeholder="sponsor"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="inline-field">
            <span>Kind</span>
            <select value={family} onChange={(e) => setFamily(e.target.value as TypeFamily)}>
              {TYPE_FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAdding(false)
                setMsg(null)
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={!label.trim()}>
              Add word
            </button>
          </div>
        </form>
      ) : (
        <button className="subtle" onClick={() => setAdding(true)}>
          Add a word
        </button>
      )}
      {msg && (
        <p className="hint error" role="alert">
          {msg}
        </p>
      )}

      {retired.length > 0 && (
        <>
          <h3>Retired words</h3>
          <p className="hint">
            Not offered for new links. The links that already use them are untouched.
          </p>
          <ul className="field-defs retired-defs">
            {retired.map((type) => {
              const n = useCounts.get(type.id) ?? 0
              return (
                <li key={type.id}>
                  <div className="field-def-row">
                    <span className="field-def-name">
                      {type.label}
                      <span className="hint desc">
                        {n > 0 ? `still on ${n} ${n === 1 ? 'tie' : 'ties'}` : 'unused'}
                      </span>
                    </span>
                    <span className="row field-def-actions">
                      <button className="quiet" onClick={() => void restoreType(type.id)}>
                        Restore
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

function TypeRowEditor({
  type,
  inUse,
  onSave,
  onDone,
  onRetire,
}: {
  type: RelationshipType
  inUse: number
  onSave: (next: RelationshipType) => Promise<string | null>
  onDone: () => void
  onRetire: () => void
}) {
  const [label, setLabel] = useState(type.label)
  const [family, setFamily] = useState<TypeFamily>(familyOf(type))
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="add-field"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(await onSave({ ...type, label, family }))
      }}
    >
      <label>
        Word
        <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        {inUse > 0 && (
          <span className="hint desc">
            Renaming changes it on {inUse} {inUse === 1 ? 'tie' : 'ties'}.
          </span>
        )}
      </label>
      <label className="inline-field">
        <span>Kind</span>
        <select value={family} onChange={(e) => setFamily(e.target.value as TypeFamily)}>
          {TYPE_FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrap editor-actions">
        <button type="button" className="quiet" onClick={onRetire}>
          {inUse > 0 ? 'Retire word' : 'Delete word'}
        </button>
        <span className="row">
          <button type="button" className="quiet" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" disabled={!label.trim()}>
            Save
          </button>
        </span>
      </div>
    </form>
  )
}
