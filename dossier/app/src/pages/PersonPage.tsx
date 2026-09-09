import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MentionTextarea from '../components/MentionTextarea'
import { formatPartialDate, parsePartialDate, timeAgo } from '../lib/dates'
import { segmentBody } from '../lib/mentions'
import { CUSTOM_TYPE_COLORS, type Person, type Relationship } from '../lib/models'
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
 * The dossier (§4.1), ordered for scenario S2 — facts, relationships, and
 * open follow-ups above the notes log — with quick capture (S1) in a
 * sticky bar that is always one thumb-tap away.
 */
export default function PersonPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const records = useVaultStore((s) => s.records)
  const person = id ? records.get(id) : undefined

  if (!person || person.kind !== 'person') {
    return (
      <p>
        Not found — they may have been deleted. <Link to="/">Back to people</Link>
      </p>
    )
  }

  return (
    <article className="person">
      <header className="person-header">
        <button className="subtle back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <h1>{person.displayName}</h1>
        <Link to={`/graph?focus=${person.id}`}>Their world →</Link>
      </header>
      <Facts person={person} />
      <RelationshipSection person={person} />
      <FollowUpSection personId={person.id} />
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
      <CaptureBar person={person} />
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
    ['Phone', person.contact?.phone],
    ['Email', person.contact?.email],
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
  const initial = {
    displayName: person.displayName,
    nicknames: csv(person.nicknames),
    pronouns: person.pronouns ?? '',
    jobTitle: person.jobTitle ?? '',
    employer: person.employer ?? '',
    location: person.location ?? '',
    birthday: person.birthday ? formatPartialDate(person.birthday) : '',
    howWeMet: person.howWeMet ?? '',
    phone: person.contact?.phone ?? '',
    email: person.contact?.email ?? '',
    likes: csv(person.likes),
    dislikes: csv(person.dislikes),
    tags: csv(person.tags),
  }
  const [form, setForm] = useState(initial)
  const [dateError, setDateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder = '',
    extra: Record<string, unknown> = {},
  ) => (
    <label>
      {label}
      <input
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...extra}
      />
    </label>
  )

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    // A nonempty birthday that fails to parse is an error to show — never
    // silently dropped data (a lost birthday is exactly the kind of fact
    // this app exists to keep).
    const birthday = parsePartialDate(form.birthday)
    if (form.birthday.trim() && !birthday) {
      setDateError('Birthday not understood — try "Jun 21", "1984-06-21", or "June".')
      return
    }
    setDateError(null)
    setBusy(true)
    try {
      await updatePerson({
        ...person,
        displayName: form.displayName.trim() || person.displayName,
        nicknames: uncsv(form.nicknames),
        pronouns: form.pronouns.trim() || undefined,
        jobTitle: form.jobTitle.trim() || undefined,
        employer: form.employer.trim() || undefined,
        location: form.location.trim() || undefined,
        birthday,
        howWeMet: form.howWeMet.trim() || undefined,
        contact:
          form.phone.trim() || form.email.trim()
            ? { phone: form.phone.trim() || undefined, email: form.email.trim() || undefined }
            : undefined,
        likes: uncsv(form.likes),
        dislikes: uncsv(form.dislikes),
        tags: uncsv(form.tags),
      })
      done()
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    if (dirty && !confirm('Discard your edits?')) return
    done()
  }

  return (
    <form className="facts-form" onSubmit={save}>
      {field('displayName', 'Name')}
      {field('nicknames', 'Nicknames', 'comma-separated', { autoCapitalize: 'none' })}
      {field('pronouns', 'Pronouns')}
      {field('jobTitle', 'Job title')}
      {field('employer', 'Employer')}
      {field('location', 'Location')}
      {field('birthday', 'Birthday', 'e.g. Jun 21, 1984-06-21, or June')}
      {dateError && (
        <p className="hint error" role="alert">
          {dateError}
        </p>
      )}
      {field('howWeMet', 'How we met')}
      {field('phone', 'Phone', '', { inputMode: 'tel', autoComplete: 'off' })}
      {field('email', 'Email', '', { inputMode: 'email', autoComplete: 'off' })}
      {field('likes', 'Likes', 'comma-separated', { autoCapitalize: 'none' })}
      {field('dislikes', 'Dislikes', 'comma-separated', { autoCapitalize: 'none' })}
      {field('tags', 'Tags', 'comma-separated', { autoCapitalize: 'none' })}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
        <button type="button" className="subtle" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function CaptureBar({ person }: { person: Person }) {
  const records = useVaultStore((s) => s.records)
  const saveNote = useVaultStore((s) => s.saveNote)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const others = useMemo(
    () => selectPeople(records).filter((p) => p.id !== person.id),
    [records, person.id],
  )
  const isFresh = useMemo(
    () => selectNotes(records, person.id).length === 0 && !person.jobTitle,
    [records, person.id, person.jobTitle],
  )
  const save = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await saveNote(person.id, body)
      setDraft('')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="capture-bar">
      <MentionTextarea
        people={others}
        value={draft}
        onChange={setDraft}
        placeholder="Jot something… @ to link a person"
        autoFocus={isFresh}
      />
      <div className="row">
        <button onClick={save} disabled={!draft.trim() || busy}>
          {busy ? '…' : 'Save note'}
        </button>
        {savedFlash && (
          <span className="hint saved" role="status">
            Saved ✓
          </span>
        )}
      </div>
    </section>
  )
}

function FollowUpSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const addFollowUp = useVaultStore((s) => s.addFollowUp)
  const toggleFollowUp = useVaultStore((s) => s.toggleFollowUp)
  const removeFollowUp = useVaultStore((s) => s.removeFollowUp)
  const followUps = useMemo(() => selectFollowUps(records, personId), [records, personId])
  const open = followUps.filter((f) => !f.done)
  const doneItems = followUps.filter((f) => f.done)
  const [showDone, setShowDone] = useState(false)
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [dueError, setDueError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    const dueDate = parsePartialDate(due)
    if (due.trim() && !dueDate) {
      setDueError('Date not understood — try "Sep 20" or "2026-09-20".')
      return
    }
    setDueError(null)
    setBusy(true)
    try {
      await addFollowUp(personId, text.trim(), dueDate)
      setText('')
      setDue('')
    } finally {
      setBusy(false)
    }
  }

  const items = showDone ? [...open, ...doneItems] : open
  return (
    <section>
      <h2>Follow-ups</h2>
      <ul className="follow-ups">
        {items.map((f) => (
          <li key={f.id} className={f.done ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={f.done} onChange={() => toggleFollowUp(f.id)} />
              <span>
                {f.text}
                {f.dueDate && <em> — {formatPartialDate(f.dueDate)}</em>}
              </span>
            </label>
            <button
              className="subtle icon"
              onClick={() => removeFollowUp(f.id)}
              aria-label={`Remove follow-up: ${f.text}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {doneItems.length > 0 && (
        <button className="subtle" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Hide done' : `Show done (${doneItems.length})`}
        </button>
      )}
      <form className="row" onSubmit={add}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about…"
          aria-label="New follow-up"
        />
        <input
          className="due"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          placeholder="due, e.g. Sep 20"
          aria-label="Due date (optional)"
        />
        <button type="submit" disabled={!text.trim() || busy}>
          Add
        </button>
      </form>
      {dueError && (
        <p className="hint error" role="alert">
          {dueError}
        </p>
      )}
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
  const [newTypeColor, setNewTypeColor] = useState(CUSTOM_TYPE_COLORS[0])
  const [newTypeDirected, setNewTypeDirected] = useState(false)
  // For directed types: does the arrow point away from this person
  // ("I am the parent") or toward them ("they are my parent")?
  const [outward, setOutward] = useState(true)
  const [busy, setBusy] = useState(false)

  const selectedDirected =
    typeId === 'new' ? newTypeDirected : (typeById.get(typeId)?.directed ?? false)

  const describe = (edge: Relationship) => {
    const type = typeById.get(edge.typeId)
    const outgoing = edge.fromId === person.id
    const other = personById.get(outgoing ? edge.toId : edge.fromId)
    if (!other) return null
    // Read direction naturally: "parent of Bob" vs "Carol: parent of them".
    const label =
      type?.directed && !outgoing
        ? `${type.label} them`
        : `${type?.label ?? '?'}${type?.directed ? ' →' : ''}`
    return (
      <li key={edge.id} className={edge.origin === 'mention' ? 'mention-edge' : ''}>
        <Link to={`/person/${other.id}`}>{other.displayName}</Link>
        <span className="edge-type" style={{ color: type?.color }}>
          {type?.directed && !outgoing ? `${other.displayName.split(' ')[0]} is ` : ''}
          {label}
        </span>
        {edge.origin === 'mention' && <em className="hint"> (from a mention)</em>}
        <button
          className="subtle icon"
          onClick={() => {
            if (confirm(`Remove the ${type?.label ?? ''} link to ${other.displayName}?`))
              void removeRelationship(edge.id)
          }}
          aria-label={`Remove relationship with ${other.displayName}`}
        >
          ×
        </button>
      </li>
    )
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otherId || busy) return
    setBusy(true)
    try {
      let resolvedTypeId = typeId
      if (typeId === 'new') {
        if (!newType.trim()) return
        const created = await addRelationshipType(newType, newTypeColor, newTypeDirected)
        resolvedTypeId = created.id
      }
      if (!resolvedTypeId) return
      const directed = typeById.get(resolvedTypeId)?.directed ?? newTypeDirected
      const [fromId, toId] =
        directed && !outward ? [otherId, person.id] : [person.id, otherId]
      await addRelationship(fromId, toId, resolvedTypeId)
      setOtherId('')
      setTypeId('')
      setNewType('')
      setOutward(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Relationships</h2>
      <ul className="edges">{edges.map(describe)}</ul>
      <form className="row wrap" onSubmit={add}>
        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          aria-label="Relationship type"
        >
          <option value="">type…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value="new">+ new type…</option>
        </select>
        {typeId === 'new' && (
          <>
            <input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="type name"
              aria-label="New type name"
            />
            <span className="swatches" role="radiogroup" aria-label="Type color">
              {CUSTOM_TYPE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch ${color === newTypeColor ? 'selected' : ''}`}
                  style={{ background: color }}
                  aria-label={`Color ${color}`}
                  aria-pressed={color === newTypeColor}
                  onClick={() => setNewTypeColor(color)}
                />
              ))}
            </span>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={newTypeDirected}
                onChange={(e) => setNewTypeDirected(e.target.checked)}
              />
              directed
            </label>
          </>
        )}
        {selectedDirected && (
          <button
            type="button"
            className="subtle"
            onClick={() => setOutward((v) => !v)}
            aria-label="Swap direction"
          >
            {outward ? `${person.displayName.split(' ')[0]} → them` : `them → ${person.displayName.split(' ')[0]}`}
          </button>
        )}
        <select
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          aria-label="Person"
        >
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
        <button
          type="submit"
          disabled={busy || !otherId || !typeId || (typeId === 'new' && !newType.trim())}
        >
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
      {notes.length === 0 && <p className="hint">Nothing yet — jot something below.</p>}
      <ul className="notes">
        {notes.map((note) => (
          <li key={note.id}>
            <time dateTime={new Date(note.createdAt).toISOString()}>
              {timeAgo(note.createdAt)} · {new Date(note.createdAt).toLocaleDateString()}
            </time>
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
            <button
              className="subtle icon"
              onClick={() => {
                if (confirm('Delete this note?')) void removeNote(note.id)
              }}
              aria-label="Delete note"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
