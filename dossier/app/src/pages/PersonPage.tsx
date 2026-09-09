import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MentionTextarea from '../components/MentionTextarea'
import { formatPartialDate, parsePartialDate } from '../lib/dates'
import { segmentBody } from '../lib/mentions'
import type { Person, Relationship } from '../lib/models'
import {
  selectFollowUps,
  selectNotes,
  selectPeople,
  selectRelationships,
  selectRelationshipTypes,
  useVaultStore,
} from '../store/vaultStore'

const csv = (list: string[]) => list.join(', ')
const uncsv = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * The dossier (§4.1): key facts above the fold for scenario S2, quick
 * capture for S1, then follow-ups, notes, and relationships.
 */
export default function PersonPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const records = useVaultStore((s) => s.records)
  const person = id ? records.get(id) : undefined

  if (!person || person.kind !== 'person') return <p>Not found.</p>

  return (
    <article className="person">
      <header className="person-header">
        <h1>{person.displayName}</h1>
        <Link to={`/graph?focus=${person.id}`}>Their world →</Link>
      </header>
      <Facts person={person} />
      <CaptureSection person={person} />
      <FollowUpSection personId={person.id} />
      <RelationshipSection person={person} />
      <NotesSection personId={person.id} />
      <footer className="person-footer">
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Delete ${person.displayName} and everything about them?`)) return
            await useVaultStore.getState().removePerson(person.id)
            navigate('/')
          }}
        >
          Delete person
        </button>
      </footer>
    </article>
  )
}

function Facts({ person }: { person: Person }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <FactsForm person={person} done={() => setEditing(false)} />

  const rows: [string, string | undefined][] = [
    ['Job', [person.jobTitle, person.employer].filter(Boolean).join(' @ ') || undefined],
    ['Location', person.location],
    ['Birthday', person.birthday && formatPartialDate(person.birthday)],
    ['How we met', person.howWeMet],
    ['Likes', person.likes.length ? csv(person.likes) : undefined],
    ['Dislikes', person.dislikes.length ? csv(person.dislikes) : undefined],
    ['Tags', person.tags.length ? csv(person.tags) : undefined],
  ]
  return (
    <section>
      <dl>
        {rows
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <button className="subtle" onClick={() => setEditing(true)}>
        Edit details
      </button>
    </section>
  )
}

function FactsForm({ person, done }: { person: Person; done: () => void }) {
  const updatePerson = useVaultStore((s) => s.updatePerson)
  const [form, setForm] = useState({
    displayName: person.displayName,
    nicknames: csv(person.nicknames),
    pronouns: person.pronouns ?? '',
    jobTitle: person.jobTitle ?? '',
    employer: person.employer ?? '',
    location: person.location ?? '',
    birthday: person.birthday ? formatPartialDate(person.birthday) : '',
    howWeMet: person.howWeMet ?? '',
    likes: csv(person.likes),
    dislikes: csv(person.dislikes),
    tags: csv(person.tags),
  })
  const field = (key: keyof typeof form, label: string, placeholder = '') => (
    <label>
      {label}
      <input
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  )
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await updatePerson({
      ...person,
      displayName: form.displayName.trim() || person.displayName,
      nicknames: uncsv(form.nicknames),
      pronouns: form.pronouns.trim() || undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      employer: form.employer.trim() || undefined,
      location: form.location.trim() || undefined,
      birthday: parsePartialDate(form.birthday),
      howWeMet: form.howWeMet.trim() || undefined,
      likes: uncsv(form.likes),
      dislikes: uncsv(form.dislikes),
      tags: uncsv(form.tags),
    })
    done()
  }
  return (
    <form className="facts-form" onSubmit={save}>
      {field('displayName', 'Name')}
      {field('nicknames', 'Nicknames', 'comma-separated')}
      {field('pronouns', 'Pronouns')}
      {field('jobTitle', 'Job title')}
      {field('employer', 'Employer')}
      {field('location', 'Location')}
      {field('birthday', 'Birthday', 'e.g. 1984-06-21, 06-21, or June')}
      {field('howWeMet', 'How we met')}
      {field('likes', 'Likes', 'comma-separated')}
      {field('dislikes', 'Dislikes', 'comma-separated')}
      {field('tags', 'Tags', 'comma-separated')}
      <div className="row">
        <button type="submit">Save</button>
        <button type="button" className="subtle" onClick={done}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function CaptureSection({ person }: { person: Person }) {
  const records = useVaultStore((s) => s.records)
  const saveNote = useVaultStore((s) => s.saveNote)
  const [draft, setDraft] = useState('')
  const others = useMemo(
    () => selectPeople(records).filter((p) => p.id !== person.id),
    [records, person.id],
  )
  const save = async () => {
    const body = draft.trim()
    if (!body) return
    await saveNote(person.id, body)
    setDraft('')
  }
  return (
    <section className="capture">
      <MentionTextarea
        people={others}
        value={draft}
        onChange={setDraft}
        placeholder="Jot something… @ to link a person"
      />
      <button onClick={save} disabled={!draft.trim()}>
        Save note
      </button>
    </section>
  )
}

function FollowUpSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const addFollowUp = useVaultStore((s) => s.addFollowUp)
  const toggleFollowUp = useVaultStore((s) => s.toggleFollowUp)
  const removeFollowUp = useVaultStore((s) => s.removeFollowUp)
  const followUps = useMemo(() => selectFollowUps(records, personId), [records, personId])
  const [text, setText] = useState('')
  const [due, setDue] = useState('')

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    await addFollowUp(personId, text.trim(), parsePartialDate(due))
    setText('')
    setDue('')
  }

  return (
    <section>
      <h2>Follow-ups</h2>
      <ul className="follow-ups">
        {followUps.map((f) => (
          <li key={f.id} className={f.done ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={f.done} onChange={() => toggleFollowUp(f.id)} />
              <span>
                {f.text}
                {f.dueDate && <em> — {formatPartialDate(f.dueDate)}</em>}
              </span>
            </label>
            <button className="subtle" onClick={() => removeFollowUp(f.id)} aria-label="Remove">
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={add}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about…"
        />
        <input
          className="due"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          placeholder="due (optional)"
        />
        <button type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}

function RelationshipSection({ person }: { person: Person }) {
  const records = useVaultStore((s) => s.records)
  const addRelationship = useVaultStore((s) => s.addRelationship)
  const removeRelationship = useVaultStore((s) => s.removeRelationship)
  const addRelationshipType = useVaultStore((s) => s.addRelationshipType)

  const people = useMemo(() => selectPeople(records), [records])
  const types = useMemo(
    () =>
      selectRelationshipTypes(records)
        .filter((t) => t.label !== 'mentioned')
        .sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  const edges = useMemo(
    () =>
      selectRelationships(records).filter(
        (r) => r.fromId === person.id || r.toId === person.id,
      ),
    [records, person.id],
  )
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const typeById = useMemo(
    () => new Map(selectRelationshipTypes(records).map((t) => [t.id, t])),
    [records],
  )

  const [otherId, setOtherId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [newType, setNewType] = useState('')

  const describe = (edge: Relationship) => {
    const type = typeById.get(edge.typeId)
    const outgoing = edge.fromId === person.id
    const other = personById.get(outgoing ? edge.toId : edge.fromId)
    if (!other) return null
    const label =
      type?.directed && !outgoing ? `${type.label} ← ` : `${type?.label ?? '?'} → `
    return (
      <li key={edge.id} className={edge.origin === 'mention' ? 'mention-edge' : ''}>
        <span className="edge-type" style={{ color: type?.color }}>
          {label}
        </span>
        <Link to={`/person/${other.id}`}>{other.displayName}</Link>
        {edge.origin === 'mention' && <em className="hint"> (from a mention)</em>}
        <button className="subtle" onClick={() => removeRelationship(edge.id)} aria-label="Remove">
          ×
        </button>
      </li>
    )
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otherId) return
    let resolvedTypeId = typeId
    if (typeId === 'new') {
      if (!newType.trim()) return
      await addRelationshipType(newType, '#9a6fd0', false)
      const created = selectRelationshipTypes(useVaultStore.getState().records).find(
        (t) => t.label === newType.trim() && !t.builtIn,
      )
      if (!created) return
      resolvedTypeId = created.id
    }
    if (!resolvedTypeId) return
    await addRelationship(person.id, otherId, resolvedTypeId)
    setOtherId('')
    setTypeId('')
    setNewType('')
  }

  return (
    <section>
      <h2>Relationships</h2>
      <ul className="edges">{edges.map(describe)}</ul>
      <form className="row" onSubmit={add}>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">type…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value="new">+ new type…</option>
        </select>
        {typeId === 'new' && (
          <input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="type name"
          />
        )}
        <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
          <option value="">person…</option>
          {people
            .filter((p) => p.id !== person.id)
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
        </select>
        <button type="submit" disabled={!otherId || !typeId || (typeId === 'new' && !newType.trim())}>
          Add
        </button>
      </form>
    </section>
  )
}

function NotesSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const removeNote = useVaultStore((s) => s.removeNote)
  const notes = useMemo(() => selectNotes(records, personId), [records, personId])

  return (
    <section>
      <h2>Notes</h2>
      {notes.length === 0 && <p className="hint">Nothing yet.</p>}
      <ul className="notes">
        {notes.map((note) => (
          <li key={note.id}>
            <time>{new Date(note.createdAt).toLocaleDateString()}</time>
            <p>
              {segmentBody(note.body).map((seg, i) =>
                seg.type === 'text' ? (
                  <span key={i}>{seg.text}</span>
                ) : (
                  <Link key={i} to={`/person/${seg.personId}`} className="mention">
                    @{seg.name}
                  </Link>
                ),
              )}
            </p>
            <button className="subtle" onClick={() => removeNote(note.id)} aria-label="Delete note">
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
