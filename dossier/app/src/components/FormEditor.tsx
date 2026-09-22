/**
 * The editor for the person form (REQUIREMENTS.md §8.1) — Settings.
 *
 * The built-in rows aren't here: they carry behaviour (birthday
 * reminders, contacts import, name detection) and can't be taken away.
 * What this edits is the rows the user invented.
 *
 * Retiring is the default way out. A field that leaves the form keeps
 * every answer, and Restore brings both back; deleting the answers is a
 * second, explicit act that says how many it will destroy.
 */
import { useMemo, useState } from 'react'
import ChipInput, { withDraft } from './ChipInput'
import DangerConfirm from './DangerConfirm'
import {
  FIELD_PACKS,
  FIELD_TYPE_LABELS,
  MAX_FIELDS,
  activeFields,
  retiredFields,
} from '../lib/fieldDefs'
import type { FieldDef, FieldType } from '../lib/models'
import { selectFieldDefs, selectPeople, useVaultStore } from '../store/vaultStore'

const TYPES: FieldType[] = ['text', 'longText', 'chips', 'date', 'choice', 'number', 'boolean']

export default function FormEditor() {
  const records = useVaultStore((s) => s.records)
  const addField = useVaultStore((s) => s.addField)
  const updateField = useVaultStore((s) => s.updateField)
  const retireField = useVaultStore((s) => s.retireField)
  const restoreField = useVaultStore((s) => s.restoreField)
  const deleteFieldAndAnswers = useVaultStore((s) => s.deleteFieldAndAnswers)
  const reorderFields = useVaultStore((s) => s.reorderFields)
  const applyFieldPacks = useVaultStore((s) => s.applyFieldPacks)

  const defs = useMemo(() => selectFieldDefs(records), [records])
  const active = useMemo(() => activeFields(defs), [defs])
  const retired = useMemo(() => retiredFields(defs), [defs])
  const people = useMemo(() => selectPeople(records), [records])
  /** How many people would lose an answer — the number a delete must say. */
  const answerCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of people) {
      for (const id of Object.keys(p.custom ?? {})) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [people])

  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [options, setOptions] = useState<string[]>([])
  /** What is still in the chip field when Add row is tapped (see ChipInput). */
  const [optionDraft, setOptionDraft] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const result = await addField({
      label,
      type,
      options: type === 'choice' ? withDraft(options, optionDraft) : undefined,
    })
    if (result === 'name-taken') return setMsg('That name is already a row on the form.')
    if (result === 'full') return setMsg(`A form holds ${MAX_FIELDS} rows. Retire one first.`)
    setLabel('')
    setOptions([])
    setOptionDraft('')
    setAdding(false)
  }

  const move = async (index: number, by: number) => {
    const next = [...active]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    await reorderFields(next.map((d) => d.id))
  }

  return (
    <section>
      <h2>The person form</h2>
      <p className="hint">
        What you keep about people is yours to choose. Name, pronouns, birthday and the rest
        are always there; these are the rows you added.
      </p>

      {active.length === 0 && retired.length === 0 && (
        <div className="packs">
          <p className="hint">Start from a set and edit it, or add rows one at a time.</p>
          {FIELD_PACKS.map((pack) => (
            <button
              key={pack.id}
              className="subtle pack"
              onClick={() => void applyFieldPacks([pack.id])}
            >
              <span className="pack-name">{pack.name}</span>
              <span className="hint desc">{pack.blurb}</span>
            </button>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <ul className="field-defs">
          {active.map((def, i) => (
            <li key={def.id}>
              {editingId === def.id ? (
                <FieldRowEditor
                  def={def}
                  onDone={() => setEditingId(null)}
                  onRetire={() => {
                    setEditingId(null)
                    void retireField(def.id)
                  }}
                  onSave={async (next) => {
                    const result = await updateField(next)
                    if (result === 'name-taken') return 'That name is already a row on the form.'
                    setEditingId(null)
                    return null
                  }}
                />
              ) : (
                <div className="field-def-row">
                  {/* The whole name is the target: one big tap to edit,
                      rather than a row of small words per field. */}
                  <button
                    className="field-def-name"
                    onClick={() => setEditingId(def.id)}
                    aria-label={`Edit ${def.label}`}
                  >
                    {def.label}
                    <span className="hint desc">
                      {FIELD_TYPE_LABELS[def.type]}
                      {def.type === 'date' && def.remindYearly
                        ? def.remindLeadDays
                          ? ` · reminds ${def.remindLeadDays} days before`
                          : ' · reminds on the day'
                        : ''}
                    </span>
                  </button>
                  <span className="field-def-actions">
                    <button
                      className="subtle icon"
                      aria-label={`Move ${def.label} up`}
                      disabled={i === 0}
                      onClick={() => void move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="subtle icon"
                      aria-label={`Move ${def.label} down`}
                      disabled={i === active.length - 1}
                      onClick={() => void move(i, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="add-field" onSubmit={add}>
          <label>
            Row name
            <input
              value={label}
              autoFocus
              placeholder="Allergies"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="inline-field">
            <span>Holds</span>
            <select value={type} onChange={(e) => setType(e.target.value as FieldType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {type === 'choice' && (
            <div className="field-label">
              <span id="new-choices-label">Choices</span>
              <ChipInput
                label="Choices"
                labelId="new-choices-label"
                values={options}
                onChange={setOptions}
                onDraftChange={setOptionDraft}
                placeholder="work, school, online"
              />
            </div>
          )}
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
              Add row
            </button>
          </div>
        </form>
      ) : (
        <div className="row wrap">
          <button className="subtle" onClick={() => setAdding(true)}>
            Add a row
          </button>
          {active.length > 0 && (
            <details className="packs-more">
              <summary className="quiet">Add a set…</summary>
              {FIELD_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  className="subtle pack"
                  onClick={() => void applyFieldPacks([pack.id])}
                >
                  <span className="pack-name">{pack.name}</span>
                  <span className="hint desc">{pack.blurb}</span>
                </button>
              ))}
            </details>
          )}
        </div>
      )}
      {msg && (
        <p className="hint error" role="alert">
          {msg}
        </p>
      )}

      {retired.length > 0 && (
        <>
          <h3>Retired rows</h3>
          <p className="hint">
            Off the form, and off every dossier. What people answered is still here.
          </p>
          <ul className="field-defs retired-defs">
            {retired.map((def) => {
              const n = answerCounts.get(def.id) ?? 0
              return (
                <li key={def.id}>
                  <div className="field-def-row">
                    <span className="field-def-name">
                      {def.label}
                      <span className="hint desc">
                        {n === 0
                          ? 'nobody answered this'
                          : `${n} ${n === 1 ? 'person' : 'people'} answered`}
                      </span>
                    </span>
                    <span className="row field-def-actions">
                      <button className="quiet" onClick={() => void restoreField(def.id)}>
                        Restore
                      </button>
                      <DangerConfirm
                        label="Delete answers"
                        triggerClassName="quiet"
                        trigger="Delete…"
                        triggerAriaLabel={`Delete ${def.label} and its answers`}
                        question={
                          n === 0
                            ? `Delete “${def.label}”? Nobody answered it.`
                            : `Delete “${def.label}” and what ${n} ${n === 1 ? 'person' : 'people'} answered? There is no undo.`
                        }
                        onConfirm={() => void deleteFieldAndAnswers(def.id)}
                      />
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

/** Renaming, choices, and a date row's yearly reminder. */
function FieldRowEditor({
  def,
  onSave,
  onDone,
  onRetire,
}: {
  def: FieldDef
  onSave: (next: FieldDef) => Promise<string | null>
  onDone: () => void
  onRetire: () => void
}) {
  const [label, setLabel] = useState(def.label)
  const [options, setOptions] = useState(def.options ?? [])
  const [optionDraft, setOptionDraft] = useState('')
  const [remind, setRemind] = useState(Boolean(def.remindYearly))
  const [lead, setLead] = useState(def.remindLeadDays ?? 0)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="add-field"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(
          await onSave({
            ...def,
            label,
            options: def.type === 'choice' ? withDraft(options, optionDraft) : undefined,
            remindYearly: def.type === 'date' && remind ? true : undefined,
            remindLeadDays: def.type === 'date' && remind ? lead : undefined,
          }),
        )
      }}
    >
      <label>
        Row name
        <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        {/* The type is fixed: there is no honest way to turn a list of
            allergies into a date, and every answer is already the old
            shape. Retire the row and add a new one instead. */}
        <span className="hint desc">Holds {FIELD_TYPE_LABELS[def.type].toLowerCase()}.</span>
      </label>
      {def.type === 'choice' && (
        <div className="field-label">
          <span id={`choices-${def.id}`}>Choices</span>
          {/* One chip per choice, not one long comma string: a list you
              can read at a glance and edit a word of without hunting a
              cursor through it — the same reason tags stopped being
              comma text. A typed comma still commits, so the old habit
              keeps working. */}
          <ChipInput
            label="Choices"
            labelId={`choices-${def.id}`}
            values={options}
            onChange={setOptions}
            onDraftChange={setOptionDraft}
            placeholder="work, school, online"
          />
          <span className="hint desc">Changing them never rewrites an answer.</span>
        </div>
      )}
      {def.type === 'date' && (
        <>
          <label className="toggle-row">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            <span>Remind me every year</span>
          </label>
          {remind && (
            <label className="inline-field">
              <span>Tell me</span>
              <select value={lead} onChange={(e) => setLead(Number(e.target.value))}>
                <option value={0}>on the day</option>
                <option value={1}>a day before</option>
                <option value={3}>3 days before</option>
                <option value={7}>a week before</option>
                <option value={14}>2 weeks before</option>
              </select>
            </label>
          )}
        </>
      )}
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrap editor-actions">
        {/* Retiring is the way a row leaves the form, so it lives with
            the other things you can do to the row — not as a word on
            every line of the list. */}
        <button type="button" className="quiet" onClick={onRetire}>
          Retire row
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
