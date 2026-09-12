import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import BatchAddPanel from '../components/BatchAddPanel'
import PersonPicker from '../components/PersonPicker'
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
  selectCircles,
  selectCirclesOf,
  selectFollowUps,
  selectNotes,
  selectPeople,
  selectPhotos,
  selectRelationships,
  selectRelationshipTypes,
  selectSettings,
  useVaultStore,
} from '../store/vaultStore'

const csv = (list: string[]) => list.join(', ')

/** "friend of Ada", but "boss of Ada" — not "boss of of Ada". */
const relOf = (label: string | undefined, name: string) => {
  const l = label ?? 'linked'
  return / of$/.test(l) ? `${l} ${name}` : `${l} of ${name}`
}

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
  const noteVisit = useVaultStore((s) => s.noteVisit)
  useEffect(() => {
    if (id) void noteVisit(id)
  }, [id, noteVisit])

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
        <button
          className="subtle back icon"
          // Save/Cancel are the only exits while editing (a stray Back
          // would discard the edits). A deep link (notification, pasted
          // URL) has nothing behind it: Back must land on People, not
          // leave the app.
          hidden={editing}
          onClick={() => {
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
            if (idx > 0) navigate(-1)
            else navigate('/', { replace: true })
          }}
          aria-label="Back"
        >
          ←
        </button>
        <Avatar person={person} size={44} />
        <div className="person-title">
          <h1>
            {person.displayName}
            {person.isSelf && (
              <span className="you-badge" title="This is you">
                you
              </span>
            )}
          </h1>
          {meta && <p className="person-meta">{meta}</p>}
        </div>
      </header>
      {person.isSelf && (
        <p className="banner">
          This card is you. Link people to it and the app can show how you know
          someone through others.
        </p>
      )}
      {/* Lookup order (§4.1): what to remember and what you last wrote
          come before the link-building sections. */}
      <Facts person={person} editing={editing} setEditing={setEditing} />
      <FollowUpSection personId={person.id} />
      <NotesSection personId={person.id} />
      <RelationshipSection person={person} />
      <ConnectionSection person={person} />
      <PhotoSection personId={person.id} />
      <MentionedInSection personId={person.id} />
      <footer className="person-footer" />
      {/* Hidden, not unmounted, while the facts form is open: unmounting
          would flush a half-typed draft into a permanent note with no
          feedback; hiding just cedes the bottom edge to Save/Cancel and
          the draft is still there afterwards. */}
      <CaptureBar person={person} hidden={editing} />
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
  const records = useVaultStore((s) => s.records)
  const circles = useMemo(() => selectCirclesOf(records, person.id), [records, person.id])
  if (editing) return <FactsForm person={person} done={() => setEditing(false)} />

  // Tags, likes, and dislikes are facets: each is a link into the home
  // search so "everyone who likes karaoke" is one tap away.
  const facet = (values: string[]) =>
    values.length === 0
      ? undefined
      : values.map((v, i) => (
          <span key={v}>
            {i > 0 && ', '}
            <Link to={`/?q=${encodeURIComponent(v)}`} className="facet">
              {v}
            </Link>
          </span>
        ))
  const circleChips =
    circles.length === 0
      ? undefined
      : circles.map((c) => (
          <Link
            key={c.id}
            to={`/?circle=${c.id}`}
            className="circle-chip"
            style={{ '--chip-color': c.color } as React.CSSProperties}
          >
            {c.name}
          </Link>
        ))
  const rows: [string, ReactNode][] = [
    ['Circles', circleChips],
    ['Nicknames', person.nicknames.length ? csv(person.nicknames) : undefined],
    ['Job', [person.jobTitle, person.employer].filter(Boolean).join(' @ ') || undefined],
    ['Location', person.location],
    ['Birthday', person.birthday && formatPartialDate(person.birthday)],
    ['How we met', person.howWeMet],
    ['Phone', person.contact?.phone],
    ['Email', person.contact?.email],
    ['Likes', facet(person.likes)],
    ['Dislikes', facet(person.dislikes)],
    ['Tags', facet(person.tags)],
  ]
  const filled = rows.filter(([, v]) => v)
  return (
    <section>
      <div className="section-head">
        <h2>Details</h2>
        <span className="row">
          <CopyAsTextButton person={person} />
          <button className="quiet" onClick={() => setEditing(true)}>
            Edit
          </button>
        </span>
      </div>
      {filled.length === 0 ? (
        <p className="empty-inline">
          Nothing recorded yet — tap Edit to add a job, birthday, likes or circles.
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

/**
 * The plain-text escape hatch (data outlives the tool): the dossier as
 * readable text on the clipboard, with notes flattened to "@Name". The
 * clipboard is the user's own device; this is the deliberate, per-person
 * alternative to a plaintext export file (§4.5).
 */
function CopyAsTextButton({ person }: { person: Person }) {
  const records = useVaultStore((s) => s.records)
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    const lines: string[] = [person.displayName]
    if (person.nicknames.length) lines.push(`Nicknames: ${csv(person.nicknames)}`)
    if (person.pronouns) lines.push(`Pronouns: ${person.pronouns}`)
    const job = [person.jobTitle, person.employer].filter(Boolean).join(' @ ')
    if (job) lines.push(`Job: ${job}`)
    if (person.location) lines.push(`Location: ${person.location}`)
    if (person.birthday) lines.push(`Birthday: ${formatPartialDate(person.birthday)}`)
    if (person.howWeMet) lines.push(`How we met: ${person.howWeMet}`)
    if (person.contact?.phone) lines.push(`Phone: ${person.contact.phone}`)
    if (person.contact?.email) lines.push(`Email: ${person.contact.email}`)
    if (person.likes.length) lines.push(`Likes: ${csv(person.likes)}`)
    if (person.dislikes.length) lines.push(`Dislikes: ${csv(person.dislikes)}`)
    if (person.tags.length) lines.push(`Tags: ${csv(person.tags)}`)
    const notes = selectNotes(records, person.id)
    if (notes.length) {
      lines.push('', 'Notes:')
      for (const n of notes) {
        lines.push(`- ${new Date(n.createdAt).toLocaleDateString()}: ${plainText(n.body)}`)
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }
  return (
    <button className="quiet" onClick={() => void copy()} aria-live="polite">
      {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Copy failed' : 'Copy as text'}
    </button>
  )
}

function FactsForm({ person, done }: { person: Person; done: () => void }) {
  const updatePerson = useVaultStore((s) => s.updatePerson)
  const records = useVaultStore((s) => s.records)
  const navigate = useNavigate()
  const currentSelf = useMemo(() => selectSelf(records), [records])
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
    circles: selectCirclesOf(records, person.id).map((c) => c.name),
  }
  const [form, setForm] = useState(initial)
  const addCircle = useVaultStore((s) => s.addCircle)
  const setPersonCircles = useVaultStore((s) => s.setPersonCircles)
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
      circles: selectCircles(records).map((c) => c.name),
    }
  }, [records])
  const [isSelf, setIsSelf] = useState(Boolean(person.isSelf))
  const [dateError, setDateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) || isSelf !== Boolean(person.isSelf)

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
    key: 'nicknames' | 'likes' | 'dislikes' | 'tags' | 'circles',
    label: string,
    suggestions: string[] = [],
    opts: {
      placeholder?: string
      hideLabel?: boolean
      suggestOnFocus?: boolean
      capitalize?: 'none' | 'words'
    } = {},
  ) => (
    <label className="span-2">
      {opts.hideLabel ? <span className="sr-only">{label}</span> : label}
      <ChipInput
        label={label}
        values={form[key]}
        onChange={(values) => setForm({ ...form, [key]: values })}
        suggestions={suggestions}
        capitalize={opts.capitalize}
        placeholder={opts.placeholder ?? 'one per entry'}
        suggestOnFocus={opts.suggestOnFocus}
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
      setDateError('Birthday not understood — try Jun 21, 1984-06-21, or just June.')
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.facts-form input[aria-invalid="true"]')?.focus(),
      )
      return
    }
    setDateError(null)
    // Claiming "this is me" silently un-marks the current self — say so.
    if (
      isSelf &&
      !person.isSelf &&
      currentSelf &&
      !confirm(
        `Make ${form.displayName.trim() || person.displayName} “you”? ${currentSelf.displayName} will no longer be marked as you.`,
      )
    ) {
      return
    }
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
      // Circle chips are names; unknown names become new circles.
      const ids: string[] = []
      for (const name of form.circles) {
        const existing = selectCircles(useVaultStore.getState().records).find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        )
        ids.push(existing ? existing.id : (await addCircle(name)).id)
      }
      await setPersonCircles(person.id, ids)
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
      <h2 className="form-title">Edit {person.displayName}</h2>
      <fieldset className="field-group">
        <legend>Identity</legend>
        <div className="field-grid">
          {field(
            'displayName',
            'Name',
            '',
            {
              required: true,
              autoCapitalize: 'words',
              autoComplete: 'off',
              onInvalid: (e: React.FormEvent<HTMLInputElement>) =>
                e.currentTarget.setCustomValidity('A name is needed'),
              onInput: (e: React.FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(''),
            },
            'span-2',
          )}
          {chips('nicknames', 'Nicknames', undefined, { capitalize: 'words' })}
          {field('pronouns', 'Pronouns')}
          {field('birthday', 'Birthday', 'Jun 21 or 1984-06-21', {
            onInput: () => setDateError(null),
            'aria-invalid': dateError ? true : undefined,
          })}
          {dateError && (
            <p className="field-error span-2" role="alert">
              {dateError}
            </p>
          )}
        </div>
        <label className="toggle-row">
        <input type="checkbox" checked={isSelf} onChange={(e) => setIsSelf(e.target.checked)} />
        <span>
          This is me
          <span className="hint"> — only one card can be you; it lets the app show how you know people through others.</span>
        </span>
      </label>
      </fieldset>
      <fieldset className="field-group">
        <legend>Circles</legend>
        <p className="hint">
          The circles this person is part of — “book club”, “Meridian Labs” — shown as a
          tinted area on the graph. Pick an existing circle or type a new name.
        </p>
        <div className="field-grid">
          {chips('circles', 'Circles', vocab.circles, {
            capitalize: 'words',
            placeholder: 'e.g. book club',
            hideLabel: true,
            suggestOnFocus: true,
          })}
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
      {/* Deleting lives in edit mode, not next to the everyday note box. */}
      <button
        type="button"
        className="danger"
        onClick={async () => {
          const warning = person.isSelf
            ? `Delete ${person.displayName}? This is your “me” card — “how you connect” stops working until you mark someone else as you.`
            : `Delete ${person.displayName} and everything about them? This cannot be undone.`
          if (!confirm(warning)) return
          await useVaultStore.getState().removePerson(person.id)
          navigate('/')
        }}
      >
        Delete this person
      </button>
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
  const compareExclude = useMemo(
    () => [person.id, ...people.filter((p) => p.isSelf).map((p) => p.id)],
    [people, person.id],
  )
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
                <span
                  className="path-rel"
                  style={{ '--edge-color': typeById.get(step.via!.typeId)?.color } as React.CSSProperties}
                >
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
            See on graph →
          </Link>
        </p>
      ) : (
        <p className="hint">No known chain connects you yet.</p>
      )}
      <div className="row wrap">
        <div className="inline-check compare-with">
          <span className="field-label" aria-hidden="true">
            Mutual connections with
          </span>
          <PersonPicker
            people={people}
            excludeIds={compareExclude}
            value={compareId}
            onChange={setCompareId}
            label="Compare mutual connections with"
            placeholder="Type a name…"
            emptyLabel="You"
          />
        </div>
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
                {relOf(typeById.get(m.edgeToB.typeId)?.label, person.displayName)} ·{' '}
                {relOf(typeById.get(m.edgeToA.typeId)?.label, otherName)}
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

function CaptureBar({ person, hidden = false }: { person: Person; hidden?: boolean }) {
  const records = useVaultStore((s) => s.records)
  const saveNote = useVaultStore((s) => s.saveNote)
  const addPerson = useVaultStore((s) => s.addPerson)
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
      // Guard against resurrection: if this unmount is the person being
      // DELETED, flushing would persist an orphaned note (invisible in
      // every UI, but present in exports) for a dossier that no longer
      // exists.
      if (leftover && useVaultStore.getState().records.has(person.id)) {
        void saveNote(person.id, leftover)
      }
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
    <section className="capture-bar" hidden={hidden}>
      <MentionTextarea
        people={others}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void save()}
        onCreatePerson={addPerson}
        placeholder="Jot something… type @ to link a person"
        autoFocus={isFresh}
      />
      {/* The Save row appears only once there is something to save — an
          idle bar shouldn't spend two rows of bottom chrome. */}
      {(draft.trim() !== '' || savedFlash || busy) && (
        <div className="row">
          <button
            className="primary"
            // Keep focus in the textarea on tap: a focus shift mid-tap
            // repositions the bar/tab bar and the click misses (QA bug).
            onPointerDown={(e) => e.preventDefault()}
            onClick={save}
            disabled={!draft.trim() || busy}
          >
            {busy ? '…' : 'Save note'}
          </button>
          {savedFlash && (
            <span className="hint saved" role="status">
              Saved ✓
            </span>
          )}
        </div>
      )}
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
      setDueError('Date not understood — try Sep 20 or 2026-09-20.')
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
      {items.length === 0 && (
        <p className="empty-inline">Nothing to remember for next time.</p>
      )}
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
          <span>Due <span className="optional">— optional</span></span>
          <input
            className="due"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            placeholder="Sep 20 (year optional)"
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
  const selfExclude = useMemo(() => [person.id], [person.id])
  const recentIds = selectSettings(records)?.recentIds
  const addPerson = useVaultStore((s) => s.addPerson)
  const typeById = useMemo(
    () => new Map(selectRelationshipTypes(records).map((t) => [t.id, t])),
    [records],
  )

  const [otherId, setOtherId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [focusToken, setFocusToken] = useState(0)
  const [batchOpen, setBatchOpen] = useState(false)
  const batchToggleRef = useRef<HTMLButtonElement>(null)
  const closeBatch = () => {
    setBatchOpen(false)
    requestAnimationFrame(() => batchToggleRef.current?.focus())
  }
  const [newType, setNewType] = useState('')
  const [newTypeColor, setNewTypeColor] = useState(CUSTOM_TYPE_COLORS[0])
  const [newTypeDirected, setNewTypeDirected] = useState(false)
  // For directed types: does the arrow point away from this person
  // ("I am the parent") or toward them ("they are my parent")?
  const [outward, setOutward] = useState(true)
  const [busy, setBusy] = useState(false)

  const selectedDirected =
    typeId === 'new' ? newTypeDirected : (typeById.get(typeId)?.directed ?? false)

  const first = person.displayName.split(' ')[0]
  const describe = (edge: Relationship) => {
    const type = typeById.get(edge.typeId)
    const outgoing = edge.fromId === person.id
    const other = personById.get(outgoing ? edge.toId : edge.fromId)
    if (!other) return null
    // Read as a sentence, never as an arrow: "Sam is boss of Marcus" /
    // "June is parent of Marcus" / "mentioned Ivy in a note".
    let label: string
    if (edge.origin === 'mention') {
      label = outgoing ? `${first} mentioned them in a note` : `mentioned ${first} in a note`
    } else if (type?.directed) {
      label = outgoing
        ? `${first} is ${type.label} ${other.displayName.split(' ')[0]}`
        : `${other.displayName.split(' ')[0]} is ${type.label} ${first}`
    } else {
      label = type?.label ?? 'linked'
    }
    return (
      <li key={edge.id} className={edge.origin === 'mention' ? 'mention-edge' : ''}>
        <Link to={`/person/${other.id}`}>{other.displayName}</Link>
        <span className="edge-type" style={{ '--edge-color': type?.color } as React.CSSProperties}>
          {label}
        </span>
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
      // Keep adding: the type stays selected and the caret returns to the
      // person field (quietly — no list until you type), so "Sam, Priya,
      // Theo — all coworkers" is name, Enter, Add, name, Enter, Add.
      setOtherId('')
      setTypeId(resolvedTypeId)
      setNewType('')
      setNewTypeColor(CUSTOM_TYPE_COLORS[0])
      setNewTypeDirected(false)
      setOutward(true)
      setFocusToken((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Relationships</h2>
        <Link to={`/graph?focus=${person.id}`}>See on graph →</Link>
      </div>
      {/* The batch panel sits above the list so freshly linked rows
          appear right under its status line. */}
      {batchOpen && (
        <BatchAddPanel id="batch-add-links" anchor={person} headingLevel={3} onClose={closeBatch} />
      )}
      {edges.length === 0 && (
        <p className="empty-inline">No one linked yet — pick a person and how you know them.</p>
      )}
      <ul className="edges">{edges.map(describe)}</ul>
      <form className="add-form" onSubmit={add}>
        {/* A div, not a label: once the chip shows, a label's control would
            become the × button and clicking "Person" would un-pick. */}
        <div className="span-2 field">
          <span className="field-label" aria-hidden="true">
            Person
          </span>
          <PersonPicker
            people={people}
            excludeIds={selfExclude}
            value={otherId}
            onChange={setOtherId}
            onCreate={addPerson}
            label="Person"
            placeholder="Type a name…"
            preferIds={recentIds}
            focusToken={focusToken}
            // Keyboard loop: name, Enter, Enter. With a type chosen the
            // pick sends focus to Add; without one, to the type select.
            onPicked={() =>
              requestAnimationFrame(() => {
                const form = document.querySelector<HTMLFormElement>('form.add-form:has(.person-picker)')
                const target = typeId
                  ? form?.querySelector<HTMLElement>('.add-submit')
                  : form?.querySelector<HTMLElement>('select[aria-label="Relationship type"]')
                target?.focus()
              })
            }
          />
        </div>
        <label>
          Relationship type
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            aria-label="Relationship type"
          >
            <option value="">How you know them…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="new">+ new type…</option>
          </select>
        </label>
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
              <span className="hint">Color on the graph</span>
              <span className="swatches" role="group" aria-label="Type color">
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
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={newTypeDirected}
                onChange={(e) => setNewTypeDirected(e.target.checked)}
              />
              One-way (like “parent of” or “boss of”)
            </label>
          </div>
        )}
        {selectedDirected && (
          <button
            type="button"
            className="subtle span-2"
            onClick={() => setOutward((v) => !v)}
            aria-label="Swap direction"
          >
            {(() => {
              const label =
                typeId === 'new' ? newType.trim() || 'the type' : (typeById.get(typeId)?.label ?? '')
              const other = personById.get(otherId)?.displayName.split(' ')[0] ?? 'them'
              return outward
                ? `${first} is ${label} ${other} — switch`
                : `${other} is ${label} ${first} — switch`
            })()}
          </button>
        )}
        <div className="row add-actions">
          <button
            ref={batchToggleRef}
            type="button"
            className="quiet"
            onClick={() => (batchOpen ? closeBatch() : setBatchOpen(true))}
            aria-expanded={batchOpen}
            aria-controls={batchOpen ? 'batch-add-links' : undefined}
          >
            Add several…
          </button>
          <button
            className="add-submit"
            type="submit"
            disabled={busy || !otherId || !typeId || (typeId === 'new' && !newType.trim())}
          >
            Add
          </button>
        </div>
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
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </section>
  )
}

/**
 * Modal photo view: focus moves to Close on open and returns to the
 * opener on close; Escape and any click dismiss.
 */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement) opener.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={onClose}
    >
      <img src={url} alt="" />
      <button
        ref={closeRef}
        className="subtle icon close"
        onClick={onClose}
        aria-label="Close photo"
      >
        ×
      </button>
    </div>
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
          <span className="hint" title="Current avatar">
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
  { id: 'like', label: 'Like' },
  { id: 'dislike', label: 'Dislike' },
  { id: 'tag', label: 'Tag (a label, e.g. yoga, work)' },
  { id: 'jobTitle', label: 'Job title' },
  { id: 'employer', label: 'Employer' },
  { id: 'location', label: 'Location' },
  { id: 'howWeMet', label: 'How we met' },
  { id: 'birthday', label: 'Birthday' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
] as const
type PromoteTarget = (typeof PROMOTE_TARGETS)[number]['id']

/** A note body rendered with @mentions as links. */
function NoteBody({ body }: { body: string }) {
  return (
    <p>
      {segmentBody(body).map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <Link key={i} to={`/person/${seg.personId}`} className="mention">
            @{seg.name}
          </Link>
        ),
      )}
    </p>
  )
}

function NotesSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const removeNote = useVaultStore((s) => s.removeNote)
  const notes = useMemo(() => selectNotes(records, personId), [records, personId])
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section>
      <h2>Notes</h2>
      {notes.length === 0 && (
        <p className="empty-inline">Nothing yet — use the note box at the bottom of the screen.</p>
      )}
      <ul className="notes">
        {notes.map((note) => (
          <li key={note.id}>
            <time dateTime={new Date(note.createdAt).toISOString()}>
              {timeAgo(note.createdAt)} · {new Date(note.createdAt).toLocaleDateString()}
            </time>
            {editingId === note.id ? (
              <NoteEditor
                personId={personId}
                noteId={note.id}
                body={note.body}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <NoteBody body={note.body} />
            )}
            {editingId !== note.id && (
              <div className="note-actions">
                <button
                  className="subtle"
                  onClick={() => {
                    setPromotingId(promotingId === note.id ? null : note.id)
                  }}
                  aria-expanded={promotingId === note.id}
                >
                  Save as detail…
                </button>
                <button
                  className="subtle icon"
                  onClick={() => {
                    setPromotingId(null)
                    setEditingId(note.id)
                  }}
                  aria-label="Edit note"
                  title="Edit note"
                >
                  ✎
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
            )}
            {promotingId === note.id && editingId !== note.id && (
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

/** Inline edit of an existing note; mention edges follow the new text. */
function NoteEditor({
  personId,
  noteId,
  body,
  onDone,
}: {
  personId: string
  noteId: string
  body: string
  onDone: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const updateNote = useVaultStore((s) => s.updateNote)
  const addPerson = useVaultStore((s) => s.addPerson)
  const [draft, setDraft] = useState(body)
  const [busy, setBusy] = useState(false)
  const others = useMemo(
    () => selectPeople(records).filter((p) => p.id !== personId),
    [records, personId],
  )
  const save = async () => {
    const next = draft.trim()
    if (!next || busy) return
    setBusy(true)
    try {
      if (next !== body) await updateNote(noteId, next)
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="note-editor">
      <MentionTextarea
        people={others}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void save()}
        onCreatePerson={addPerson}
        placeholder="Edit note"
        autoFocus
      />
      <div className="row">
        <button className="primary" onClick={() => void save()} disabled={busy || !draft.trim()}>
          Save
        </button>
        <button className="quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Backlinks (the Obsidian instinct): every note by someone else that
 * @mentions this person, with the sentence that explains why the dashed
 * edge exists and a link back to its author.
 */
function MentionedInSection({ personId }: { personId: string }) {
  const records = useVaultStore((s) => s.records)
  const mentions = useMemo(
    () =>
      [...records.values()]
        .filter((r) => r.kind === 'note' && r.personId !== personId && r.mentions.includes(personId))
        .map((r) => {
          const note = r as Extract<typeof r, { kind: 'note' }>
          const author = records.get(note.personId)
          return {
            note,
            authorName: author?.kind === 'person' ? author.displayName : 'Someone',
          }
        })
        .sort((a, b) => b.note.createdAt - a.note.createdAt),
    [records, personId],
  )
  if (mentions.length === 0) return null
  return (
    <section>
      <h2>Mentioned in</h2>
      <ul className="notes mentioned-in">
        {mentions.map(({ note, authorName }) => (
          <li key={note.id}>
            <time dateTime={new Date(note.createdAt).toISOString()}>
              <Link to={`/person/${note.personId}`}>{authorName}</Link> ·{' '}
              {new Date(note.createdAt).toLocaleDateString()}
            </time>
            <NoteBody body={note.body} />
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
  const [target, setTarget] = useState<PromoteTarget>('like')
  // Prefill with the first line: a multi-line note is several facts, and
  // the panel promotes one at a time.
  const [text, setText] = useState(
    plainText(noteBody)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '',
  )
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLFormElement>(null)

  // The panel expands downward near the bottom of the notes list — bring
  // it into view instead of leaving it under the page's bottom edge.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

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
    <form ref={panelRef} className="promote-panel" onSubmit={promote}>
      <p className="panel-title">Save this note as a detail</p>
      <label>
        Which detail?
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
        Text to save
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
