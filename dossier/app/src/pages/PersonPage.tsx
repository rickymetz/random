import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ChipInput from '../components/ChipInput'
import MentionTextarea from '../components/MentionTextarea'
import { mutualConnections, selectSelf, shortestPath } from '../lib/graphQueries'
import { GALLERY_MAX_DIM, downscaleImage } from '../lib/image'
import { getPhotoUrl, peekPhotoUrl } from '../lib/photoCache'
import type { Photo } from '../lib/models'
import { formatPartialDate, parsePartialDate, timeAgo } from '../lib/dates'
import { plainText, segmentBody } from '../lib/mentions'
import { CUSTOM_TYPE_COLORS, type Person, type Relationship } from '../lib/models'
import {
  selectFollowUps,
  selectNotes,
  selectPeople,
  selectPhotos,
  selectRelationships,
  selectRelationshipTypes,
  useVaultStore,
} from '../store/vaultStore'

const csv = (list: string[]) => list.join(', ')

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
  // Lifted so the sticky capture bar yields the bottom edge to the facts
  // form's sticky Save/Cancel while editing.
  const [editing, setEditing] = useState(false)

  if (!person || person.kind !== 'person') {
    return (
      <p>
        Not found — they may have been deleted. <Link to="/">Back to people</Link>
      </p>
    )
  }

  const meta = [
    [person.jobTitle, person.employer].filter(Boolean).join(' @ '),
    person.location,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="person">
      <header className="person-header">
        <button className="subtle back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <Avatar person={person} size={44} />
        <div className="person-title">
          <h1>
            {person.displayName}
            {person.isSelf && (
              <span className="you-badge" aria-label="This is you">
                you
              </span>
            )}
          </h1>
          {meta && <p className="person-meta">{meta}</p>}
        </div>
      </header>
      <Facts person={person} editing={editing} setEditing={setEditing} />
      <RelationshipSection person={person} />
      <ConnectionSection person={person} />
      <FollowUpSection personId={person.id} />
      <PhotoSection personId={person.id} />
      <NotesSection personId={person.id} />
      <footer className="person-footer">
        <button
          className="danger"
          onClick={async () => {
            const warning = person.isSelf
              ? `Delete ${person.displayName}? This is your “me” person — connection queries stop working until you mark someone else as you.`
              : `Delete ${person.displayName} and everything about them?`
            if (!confirm(warning)) return
            await useVaultStore.getState().removePerson(person.id)
            navigate('/')
          }}
        >
          Delete person
        </button>
      </footer>
      {!editing && <CaptureBar person={person} />}
    </article>
  )
}

function Facts({
  person,
  editing,
  setEditing,
}: {
  person: Person
  editing: boolean
  setEditing: (v: boolean) => void
}) {
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
  const filled = rows.filter(([, v]) => v)
  return (
    <section>
      <div className="section-head">
        <h2>Details</h2>
        <button className="quiet" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      {filled.length === 0 ? (
        <p className="empty">
          Nothing recorded yet — Edit adds job, birthday, likes, and more.
        </p>
      ) : (
        <div className="facts-card">
          <dl>
            {filled.map(([label, v]) => (
              <div key={label} className="fact">
                <dt>{label}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  )
}

function FactsForm({ person, done }: { person: Person; done: () => void }) {
  const updatePerson = useVaultStore((s) => s.updatePerson)
  const records = useVaultStore((s) => s.records)
  const initial = {
    displayName: person.displayName,
    nicknames: person.nicknames,
    pronouns: person.pronouns ?? '',
    jobTitle: person.jobTitle ?? '',
    employer: person.employer ?? '',
    location: person.location ?? '',
    birthday: person.birthday ? formatPartialDate(person.birthday) : '',
    howWeMet: person.howWeMet ?? '',
    phone: person.contact?.phone ?? '',
    email: person.contact?.email ?? '',
    likes: person.likes,
    dislikes: person.dislikes,
    tags: person.tags,
  }
  const [form, setForm] = useState(initial)
  // Shared vocabulary across all people, so spellings converge (§4.1).
  const vocab = useMemo(() => {
    const collect = (pick: (p: Person) => string[]) => {
      const seen = new Map<string, string>()
      for (const p of selectPeople(records)) {
        for (const v of pick(p)) seen.set(v.toLowerCase(), v)
      }
      return [...seen.values()].sort()
    }
    return {
      tags: collect((p) => p.tags),
      likes: collect((p) => p.likes),
      dislikes: collect((p) => p.dislikes),
    }
  }, [records])
  const [isSelf, setIsSelf] = useState(Boolean(person.isSelf))
  const [dateError, setDateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  type TextKey =
    | 'displayName'
    | 'pronouns'
    | 'jobTitle'
    | 'employer'
    | 'location'
    | 'birthday'
    | 'howWeMet'
    | 'phone'
    | 'email'
  const field = (
    key: TextKey,
    label: string,
    placeholder = '',
    extra: Record<string, unknown> = {},
    className?: string,
  ) => (
    <label className={className}>
      {label}
      <input
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...extra}
      />
    </label>
  )
  const chips = (
    key: 'nicknames' | 'likes' | 'dislikes' | 'tags',
    label: string,
    suggestions: string[] = [],
  ) => (
    <label className="span-2">
      {label}
      <ChipInput
        label={label}
        values={form[key]}
        onChange={(values) => setForm({ ...form, [key]: values })}
        suggestions={suggestions}
        placeholder="type and press enter"
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
        nicknames: form.nicknames,
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
        likes: form.likes,
        dislikes: form.dislikes,
        tags: form.tags,
        isSelf: isSelf || undefined,
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
      <h2 className="form-title">Edit details</h2>
      <fieldset className="field-group">
        <legend>Identity</legend>
        <div className="field-grid">
          {field('displayName', 'Name', '', {}, 'span-2')}
          {chips('nicknames', 'Nicknames')}
          {field('pronouns', 'Pronouns')}
          {field('birthday', 'Birthday', 'e.g. Jun 21 or 1984-06-21', {
            'aria-invalid': dateError ? true : undefined,
          })}
          {dateError && (
            <p className="field-error span-2" role="alert">
              {dateError}
            </p>
          )}
        </div>
      </fieldset>
      <fieldset className="field-group">
        <legend>Work & life</legend>
        <div className="field-grid">
          {field('jobTitle', 'Job title')}
          {field('employer', 'Employer')}
          {field('location', 'Location', '', {}, 'span-2')}
          <label className="span-2">
            How we met
            <textarea
              rows={2}
              value={form.howWeMet}
              onChange={(e) => setForm({ ...form, howWeMet: e.target.value })}
              placeholder="the story, in a line or two"
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="field-group">
        <legend>Contact</legend>
        <div className="field-grid">
          {field('phone', 'Phone', '', { inputMode: 'tel', autoComplete: 'off' })}
          {field('email', 'Email', '', { inputMode: 'email', autoComplete: 'off' })}
        </div>
      </fieldset>
      <fieldset className="field-group">
        <legend>Preferences</legend>
        <div className="field-grid">
          {chips('likes', 'Likes', vocab.likes)}
          {chips('dislikes', 'Dislikes', vocab.dislikes)}
          {chips('tags', 'Tags', vocab.tags)}
        </div>
      </fieldset>
      <label className="toggle-row">
        <input type="checkbox" checked={isSelf} onChange={(e) => setIsSelf(e.target.checked)} />
        This is me (anchors "how you connect" queries)
      </label>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
        <button type="button" className="subtle" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * Graph queries surfaced in prose (§4.4): "how do I know X" as the
 * shortest path from the self person, plus mutual connections against
 * the self person or anyone else.
 */
function ConnectionSection({ person }: { person: Person }) {
  const records = useVaultStore((s) => s.records)
  const self = useMemo(() => selectSelf(records), [records])
  const typeById = useMemo(
    () => new Map(selectRelationshipTypes(records).map((t) => [t.id, t])),
    [records],
  )
  const [compareId, setCompareId] = useState<string>('')
  const people = useMemo(
    () =>
      selectPeople(records)
        .filter((p) => p.id !== person.id)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [records, person.id],
  )

  const selfId = self?.id ?? ''
  const otherId = compareId && records.has(compareId) ? compareId : selfId
  const path = useMemoPath(records, selfId, person.id)
  const mutuals = useMemoMutuals(records, otherId, person.id)
  const hasAnyEdge = useMemo(
    () =>
      [...records.values()].some(
        (r) => r.kind === 'relationship' && (r.fromId === person.id || r.toId === person.id),
      ),
    [records, person.id],
  )
  if (person.id === selfId) return null
  if (!self) {
    return (
      <section>
        <h2>How you connect</h2>
        <p className="hint">
          No “me” set — tick “This is me” in someone's Edit details to enable
          connection queries.
        </p>
      </section>
    )
  }
  // Nothing to say yet: stay out of the way of the lookup scenario.
  if (!path && mutuals.length === 0 && !hasAnyEdge) return null
  const otherName =
    otherId === self.id
      ? 'you'
      : ((records.get(otherId) as Person | undefined)?.displayName ?? 'them')

  // The BFS treats edges as undirected; render each label with the arrow
  // matching the STORED direction so "mentioned" never reads backwards.
  const edgeLabel = (stepIndex: number) => {
    const step = path![stepIndex]
    const prev = path![stepIndex - 1]
    const type = typeById.get(step.via!.typeId)
    const label = type?.label ?? 'linked'
    if (!type?.directed && step.via!.origin !== 'mention') return ` —${label}— `
    const forward = step.via!.fromId === prev.person.id
    return forward ? ` —${label}→ ` : ` ←${label}— `
  }

  return (
    <section>
      <h2>How you connect</h2>
      {path ? (
        <p className="path">
          {path.map((step, i) => (
            <span key={step.person.id}>
              {i > 0 && (
                <span className="path-rel" style={{ color: typeById.get(step.via!.typeId)?.color }}>
                  {edgeLabel(i)}
                </span>
              )}
              {step.person.id === person.id || step.person.isSelf ? (
                <strong>{step.person.isSelf ? 'You' : step.person.displayName}</strong>
              ) : (
                <Link to={`/person/${step.person.id}`}>{step.person.displayName}</Link>
              )}
            </span>
          ))}
          <Link className="path-graph-link" to={`/graph?path=${person.id}`}>
            show on graph →
          </Link>
        </p>
      ) : (
        <p className="hint">No known chain connects you yet.</p>
      )}
      <div className="row wrap">
        <label className="inline-check">
          Mutual connections with
          <select
            value={compareId}
            onChange={(e) => setCompareId(e.target.value)}
            aria-label="Compare mutual connections with"
          >
            <option value="">you</option>
            {people
              .filter((p) => !p.isSelf)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </select>
        </label>
      </div>
      {mutuals.length === 0 ? (
        <p className="hint">
          No mutual connections between {person.displayName} and {otherName}.
        </p>
      ) : (
        <ul className="edges">
          {mutuals.map((m) => (
            <li key={m.person.id}>
              <Link to={`/person/${m.person.id}`}>{m.person.displayName}</Link>
              <span className="hint">
                {typeById.get(m.edgeToB.typeId)?.label ?? 'linked'} of {person.displayName} ·{' '}
                {typeById.get(m.edgeToA.typeId)?.label ?? 'linked'} of {otherName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function useMemoPath(
  records: ReturnType<typeof useVaultStore.getState>['records'],
  fromId: string,
  toId: string,
) {
  return useMemo(
    () => (fromId ? shortestPath(records, fromId, toId) : null),
    [records, fromId, toId],
  )
}

function useMemoMutuals(
  records: ReturnType<typeof useVaultStore.getState>['records'],
  aId: string,
  bId: string,
) {
  return useMemo(
    () => (aId ? mutualConnections(records, aId, bId) : []),
    [records, aId, bId],
  )
}

function CaptureBar({ person }: { person: Person }) {
  const records = useVaultStore((s) => s.records)
  const saveNote = useVaultStore((s) => s.saveNote)
  const registerDraft = useVaultStore((s) => s.registerDraft)
  const unregisterDraft = useVaultStore((s) => s.unregisterDraft)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const draftRef = useRef('')
  draftRef.current = draft

  // Timer-driven locks flush this draft into an encrypted note instead of
  // eating it, and so does navigating away (tapping an @mention link
  // remounts the page — the fact you just typed must not vanish).
  useEffect(() => {
    registerDraft(person.id, () => draftRef.current)
    return () => {
      const leftover = draftRef.current.trim()
      if (leftover) void saveNote(person.id, leftover)
      unregisterDraft(person.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, registerDraft, unregisterDraft])
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
    // Zero the ref synchronously so an unmount during the await can't
    // double-save this draft through the cleanup flush.
    draftRef.current = ''
    setDraft('')
    try {
      await saveNote(person.id, body)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch {
      setDraft(body) // restore on failure
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
        <button className="primary" onClick={save} disabled={!draft.trim() || busy}>
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
      {items.length === 0 && <p className="empty-inline">Nothing to chase.</p>}
      <ul className="follow-ups">
        {items.map((f) => (
          <li key={f.id} className={f.done ? 'done' : ''}>
            <label className="check">
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
        <button className="quiet" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Hide done' : `Show done (${doneItems.length})`}
        </button>
      )}
      <form className="add-form" onSubmit={add}>
        <label className="span-2">
          New follow-up
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about…"
            aria-label="New follow-up"
          />
        </label>
        <label>
          Due <span className="optional">— optional</span>
          <input
            className="due"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            placeholder="e.g. Sep 20"
            aria-label="Due date (optional)"
            aria-invalid={dueError ? true : undefined}
          />
        </label>
        <button type="submit" disabled={!text.trim() || busy}>
          Add
        </button>
        {dueError && (
          <p className="field-error span-2" role="alert">
            {dueError}
          </p>
        )}
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
      <div className="section-head">
        <h2>Relationships</h2>
        <Link to={`/graph?focus=${person.id}`}>Their world →</Link>
      </div>
      {edges.length === 0 && <p className="empty-inline">No links yet.</p>}
      <ul className="edges">{edges.map(describe)}</ul>
      <form className="add-form" onSubmit={add}>
        <label className="span-2">
          Link to someone
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
        </label>
        <label>
          As
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
        </label>
        <button
          type="submit"
          disabled={busy || !otherId || !typeId || (typeId === 'new' && !newType.trim())}
        >
          Add
        </button>
        {typeId === 'new' && (
          <div className="subform">
            <label>
              New type name
              <input
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                placeholder="e.g. neighbor"
                aria-label="New type name"
              />
            </label>
            <div className="row wrap">
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
            </div>
          </div>
        )}
        {selectedDirected && (
          <button
            type="button"
            className="subtle span-2"
            onClick={() => setOutward((v) => !v)}
            aria-label="Swap direction"
          >
            {outward ? `${person.displayName.split(' ')[0]} → them` : `them → ${person.displayName.split(' ')[0]}`}
          </button>
        )}
      </form>
    </section>
  )
}

function PhotoSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const addPhotoBytes = useVaultStore((s) => s.addPhotoBytes)
  const removePhoto = useVaultStore((s) => s.removePhoto)
  const setAvatarPhoto = useVaultStore((s) => s.setAvatarPhoto)
  const photos = useMemo(() => selectPhotos(records, personId), [records, personId])
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lightbox, setLightbox] = useState<string | null>(null)

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      let hasPhotos = photos.length > 0
      for (const file of files) {
        const { bytes, mimeType } = await downscaleImage(file, GALLERY_MAX_DIM)
        // The first photo ever becomes the avatar automatically.
        await addPhotoBytes(personId, bytes, mimeType, !hasPhotos)
        hasPhotos = true
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Photos</h2>
      <ul className="photo-grid">
        {photos.map((photo) => (
          <PhotoThumb
            key={photo.id}
            photo={photo}
            onOpen={(url) => setLightbox(url)}
            onMakeAvatar={() => void setAvatarPhoto(photo.id)}
            onRemove={() => {
              const warning = photo.isAvatar
                ? 'Delete this photo? It is the avatar — the next photo takes over.'
                : 'Delete this photo?'
              if (confirm(warning)) void removePhoto(photo.id)
            }}
          />
        ))}
        <li>
          <button
            className="photo-add-tile"
            disabled={busy}
            aria-busy={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Processing…' : '+ Add photos'}
          </button>
        </li>
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void onPick(e)}
      />
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-label="Photo"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" />
          <button className="subtle icon close" aria-label="Close photo">
            ×
          </button>
        </div>
      )}
    </section>
  )
}

function PhotoThumb({
  photo,
  onOpen,
  onMakeAvatar,
  onRemove,
}: {
  photo: Photo
  onOpen: (url: string) => void
  onMakeAvatar: () => void
  onRemove: () => void
}) {
  const vault = useVaultStore((s) => s.vault)
  const [url, setUrl] = useState<string | null>(() =>
    peekPhotoUrl(photo.blobRecordId, photo.mimeType),
  )
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (vault && !url) {
      void getPhotoUrl(vault, photo.blobRecordId, photo.mimeType).then((u) => {
        if (cancelled) return
        if (u) setUrl(u)
        else setFailed(true)
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, photo.blobRecordId, photo.mimeType])
  return (
    <li className="photo-thumb">
      {url ? (
        <button className="photo-open" onClick={() => onOpen(url)} aria-label="View photo">
          <img src={url} alt="" draggable={false} />
        </button>
      ) : failed ? (
        <span className="photo-loading photo-missing">unavailable</span>
      ) : (
        <span className="photo-loading" />
      )}
      <div className="photo-actions">
        {photo.isAvatar ? (
          <span className="hint" aria-label="Current avatar">
            avatar ✓
          </span>
        ) : (
          <button className="subtle" onClick={onMakeAvatar} aria-label="Use as avatar">
            avatar
          </button>
        )}
        <button className="subtle icon" onClick={onRemove} aria-label="Delete photo">
          ×
        </button>
      </div>
    </li>
  )
}

/** Promotable targets for note triage (§4.1 inbox model). */
const PROMOTE_TARGETS = [
  { id: 'jobTitle', label: 'Job title' },
  { id: 'employer', label: 'Employer' },
  { id: 'location', label: 'Location' },
  { id: 'birthday', label: 'Birthday' },
  { id: 'howWeMet', label: 'How we met' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'like', label: 'Like' },
  { id: 'dislike', label: 'Dislike' },
  { id: 'tag', label: 'Tag' },
] as const
type PromoteTarget = (typeof PROMOTE_TARGETS)[number]['id']

function NotesSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const removeNote = useVaultStore((s) => s.removeNote)
  const notes = useMemo(() => selectNotes(records, personId), [records, personId])
  const [promotingId, setPromotingId] = useState<string | null>(null)

  return (
    <section>
      <h2>Notes</h2>
      {notes.length === 0 && (
        <p className="empty">Nothing yet — jot something below.</p>
      )}
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
            <div className="note-actions">
              <button
                className="subtle"
                onClick={() => setPromotingId(promotingId === note.id ? null : note.id)}
                aria-expanded={promotingId === note.id}
              >
                → field
              </button>
              <button
                className="subtle icon"
                onClick={() => {
                  if (confirm('Delete this note?')) void removeNote(note.id)
                }}
                aria-label="Delete note"
              >
                ×
              </button>
            </div>
            {promotingId === note.id && (
              <PromotePanel
                personId={personId}
                noteId={note.id}
                noteBody={note.body}
                onDone={() => setPromotingId(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Triage a hurried note into a structured field (§4.1: "a later triage
 * affordance suggests promoting them to structured fields"). The text is
 * prefilled from the note and editable, so "works at anthropic, hates
 * cilantro" can be trimmed down per promotion.
 */
function PromotePanel({
  personId,
  noteId,
  noteBody,
  onDone,
}: {
  personId: string
  noteId: string
  noteBody: string
  onDone: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const updatePerson = useVaultStore((s) => s.updatePerson)
  const removeNote = useVaultStore((s) => s.removeNote)
  const [target, setTarget] = useState<PromoteTarget>('jobTitle')
  const [text, setText] = useState(plainText(noteBody))
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const promote = async (e: React.FormEvent) => {
    e.preventDefault()
    const person = records.get(personId)
    if (!person || person.kind !== 'person' || busy) return
    const value = text.trim()
    if (!value) return
    setError(null)
    const next: Person = { ...person }
    switch (target) {
      case 'birthday': {
        const parsed = parsePartialDate(value)
        if (!parsed) {
          setError('Date not understood — try "Jun 21" or "1984-06-21".')
          return
        }
        next.birthday = parsed
        break
      }
      case 'jobTitle':
      case 'employer':
      case 'location':
      case 'howWeMet':
        next[target] = value
        break
      case 'phone':
        next.contact = { ...next.contact, phone: value }
        break
      case 'email':
        next.contact = { ...next.contact, email: value }
        break
      case 'like':
        if (!next.likes.some((v) => v.toLowerCase() === value.toLowerCase()))
          next.likes = [...next.likes, value]
        break
      case 'dislike':
        if (!next.dislikes.some((v) => v.toLowerCase() === value.toLowerCase()))
          next.dislikes = [...next.dislikes, value]
        break
      case 'tag':
        if (!next.tags.some((v) => v.toLowerCase() === value.toLowerCase()))
          next.tags = [...next.tags, value]
        break
    }
    setBusy(true)
    try {
      await updatePerson(next)
      if (deleteAfter) await removeNote(noteId)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="promote-panel" onSubmit={promote}>
      <p className="panel-title">Save to a field</p>
      <label>
        Field
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as PromoteTarget)}
          aria-label="Promote to field"
        >
          {PROMOTE_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Value to save"
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={deleteAfter}
          onChange={(e) => setDeleteAfter(e.target.checked)}
        />
        delete the note after
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
