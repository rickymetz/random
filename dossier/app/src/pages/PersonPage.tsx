import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import BatchAddPanel from '../components/BatchAddPanel'
import { useGrow } from '../components/useGrow'
import PersonPicker from '../components/PersonPicker'
import ChipInput, { withDraft } from '../components/ChipInput'
import CustomFieldInputs, { draftFrom, type DraftValue } from '../components/CustomFieldInputs'
import { activeFields, hasValue } from '../lib/fieldDefs'
import DangerConfirm from '../components/DangerConfirm'
import LooksLikePeople from '../components/LooksLikePeople'
import MentionTextarea from '../components/MentionTextarea'
import { mutualConnections, selectSelf, shortestPath } from '../lib/graphQueries'
import { roleDates, roleLabel } from '../lib/relationships'
import { GALLERY_MAX_DIM, downscaleImage } from '../lib/image'
import { getPhotoUrl, peekPhotoUrl } from '../lib/photoCache'
import type { Photo } from '../lib/models'
import { formatPartialDate, parsePartialDate, timeAgo } from '../lib/dates'
import { plainText, retokenize, segmentBody } from '../lib/mentions'
import { detectNames } from '../lib/nameDetect'
import {
  TYPE_FAMILIES,
  type CustomValue,
  type FieldDef,
  type PartialDate,
  type Person,
  type Relationship,
  type TypeFamily,
} from '../lib/models'
import {
  selectCircles,
  selectCirclesOf,
  selectFollowUps,
  selectNotes,
  selectFieldDefs,
  selectPeople,
  selectPhotos,
  selectRelationships,
  selectRelationshipTypes,
  selectSettings,
  useVaultStore,
} from '../store/vaultStore'

const csv = (list: string[]) => list.join(', ')

/**
 * One custom answer, as the dossier draws it. Lists become facets like
 * tags and likes — tap "rock climbing" to see everyone who shares it —
 * and a "no" shows as a "no", because someone answered that on purpose.
 */
function customRow(
  def: FieldDef,
  value: CustomValue | undefined,
  facet: (values: string[]) => ReactNode,
): ReactNode {
  if (!hasValue(value)) return undefined
  if (def.type === 'chips') return facet(value as string[])
  if (def.type === 'boolean') return value === true ? 'Yes' : 'No'
  if (def.type === 'date') return formatPartialDate(value as PartialDate)
  return String(value)
}

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
      {/* Back lives in the sticky app bar (App.tsx) so it is reachable
          after scrolling; while editing, Save/Cancel are the only exits. */}
      <header className="person-header">
        <Avatar person={person} size={44} />
        <div className="person-title">
          <h1>
            {person.displayName}
            {person.isSelf && (
              <>
                <span className="you-badge" title="This is you" aria-hidden="true">
                  you
                </span>
                <span className="sr-only"> (this is you)</span>
              </>
            )}
          </h1>
          {meta && <p className="person-meta">{meta}</p>}
        </div>
      </header>
      {person.isSelf && (
        <p className="banner">
          This is you. Relationships added here power “How you connect”.
        </p>
      )}
      {/* Lookup order (§4.1): what to remember and what you last wrote
          come before the link-building sections. */}
      {/* The note box comes first in the document — one Tab from the app
          bar on desktop, the first thing a screen reader meets after the
          name — and is painted last (CSS order): a sticky bar at the
          bottom. Hidden, not unmounted, while the facts form is open:
          unmounting would stash a half-typed draft; hiding just cedes the
          bottom edge to Save/Cancel and the draft is still there after. */}
      <CaptureBar person={person} hidden={editing} />
      {/* Two columns on a wide screen (≥64rem): what you remember and
          write on the left, who they know on the right. On a phone the
          columns are `display: contents`, so this is one flow. */}
      <div className="person-col main">
        <Facts person={person} editing={editing} setEditing={setEditing} />
        <FollowUpSection personId={person.id} />
        <NotesSection personId={person.id} />
        <MentionedInSection personId={person.id} />
      </div>
      <div className="person-col side">
        <RelationshipSection person={person} />
        <ConnectionSection person={person} />
        <PhotoSection personId={person.id} />
      </div>
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
  const setHomeQuery = useVaultStore((s) => s.setHomeQuery)
  const circles = useMemo(() => selectCirclesOf(records, person.id), [records, person.id])
  if (editing)
    return (
      <FactsForm
        person={person}
        done={() => {
          setEditing(false)
          // Back to the Edit button once the section remounts.
          requestAnimationFrame(() => document.getElementById('edit-details')?.focus())
        }}
      />
    )

  // Tags, likes, and dislikes are facets: each is a link into the home
  // search so "everyone who likes karaoke" is one tap away. The query
  // rides in the store, not the URL: a tag is data, and a URL lands in
  // the browser's history and address-bar suggestions (§6.1).
  const facet = (values: string[]) =>
    values.length === 0
      ? undefined
      : values.map((v, i) => (
          <span key={v}>
            {i > 0 && ', '}
            <Link to="/" className="facet" onClick={() => setHomeQuery(v)}>
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
    // The rows this vault added for itself, in form order. Only what has
    // been answered draws: a form of twenty fields still leaves a short
    // page for a work contact you know three things about. A retired
    // field's answers wait quietly in the record, off the page.
    ...activeFields(selectFieldDefs(records)).map(
      (def): [string, ReactNode] => [def.label, customRow(def, person.custom?.[def.id], facet)],
    ),
  ]
  const filled = rows.filter(([, v]) => v)
  // Nothing to copy from an empty dossier: the button waits for content.
  const hasNotes = selectNotes(records, person.id).length > 0
  return (
    <section>
      <div className="section-head">
        <h2>Details</h2>
        <span className="row">
          {(filled.length > 0 || hasNotes) && <CopyAsTextButton person={person} />}
          <button id="edit-details" className="quiet" onClick={() => setEditing(true)}>
            Edit
          </button>
        </span>
      </div>
      {filled.length === 0 ? (
        <p className="empty-inline">
          Nothing yet — tap Edit.
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
  const [state, setState] = useState<'idle' | 'copied' | 'copied-warn' | 'failed'>('idle')
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
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
    const nameOf = (id: string) => {
      const r = records.get(id)
      return r?.kind === 'person' ? r.displayName : 'Someone'
    }
    const circles = selectCirclesOf(records, person.id)
    if (circles.length) lines.push(`Circles: ${csv(circles.map((c) => c.name))}`)
    const types = new Map(selectRelationshipTypes(records).map((t) => [t.id, t]))
    const edges = selectRelationships(records).filter((e) => e.fromId === person.id || e.toId === person.id)
    if (edges.length) {
      lines.push('', 'Relationships:')
      for (const e of edges) {
        const type = types.get(e.typeId)
        const other = nameOf(e.fromId === person.id ? e.toId : e.fromId)
        const when = roleDates(e)
        const suffix = when ? ` (${when})` : ''
        if (e.origin === 'mention') lines.push(`- ${other} (mentioned in a note)`)
        else if (type?.directed)
          lines.push(
            (e.fromId === person.id
              ? `- ${person.displayName} is ${type.label} ${other}`
              : `- ${other} is ${type.label} ${person.displayName}`) +
              (e.former ? ' (former)' : '') +
              suffix,
          )
        else lines.push(`- ${other}: ${roleLabel(type?.label ?? 'linked', e)}${suffix}`)
      }
    }
    const followUps = selectFollowUps(records, person.id).filter((f) => !f.done)
    if (followUps.length) {
      lines.push('', 'Follow-ups:')
      for (const f of followUps) lines.push(`- ${f.text}${f.dueDate ? ` (due ${formatPartialDate(f.dueDate)})` : ''}`)
    }
    const notes = selectNotes(records, person.id)
    if (notes.length) {
      lines.push('', 'Notes:')
      for (const n of notes) lines.push(`- ${iso(n.createdAt)}: ${plainText(n.body)}`)
    }
    const mentionedBy = [...records.values()].filter(
      (r) => r.kind === 'note' && r.personId !== person.id && r.mentions.includes(person.id),
    )
    if (mentionedBy.length) {
      lines.push('', 'Mentioned in:')
      for (const n of mentionedBy) {
        if (n.kind === 'note') lines.push(`- ${nameOf(n.personId)}, ${iso(n.createdAt)}: ${plainText(n.body)}`)
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      // §6.7: say once that a clipboard can outlive the tap — history
      // managers and cross-device clipboard sync keep what was copied.
      let warned = true
      try {
        warned = localStorage.getItem('clipboard-warned') === '1'
        localStorage.setItem('clipboard-warned', '1')
      } catch {
        // No storage: warn this time, then again next time.
      }
      setState(warned ? 'copied' : 'copied-warn')
      setTimeout(() => setState('idle'), warned ? 2000 : 5000)
      return
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }
  // The button keeps its name; the outcome is a status beside it (a
  // control whose name changes under the cursor is not announced).
  return (
    <>
      <button className="quiet" onClick={() => void copy()}>
        Copy as text
      </button>
      <span className="hint saved copy-status" role="status">
        {state === 'copied'
          ? 'Copied'
          : state === 'copied-warn'
            ? 'Copied — clipboards can sync and keep history'
            : state === 'failed'
              ? 'Copy failed'
              : ''}
      </span>
    </>
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
  /**
   * What each chip field still has in it, unchipped. A chip field cannot
   * commit on its way out — growing by a row while your finger is down
   * moves Save and eats the tap — so Save collects the leftovers here
   * (`withDraft`). Keyed by field: built-ins by name, custom rows by id.
   */
  const [chipDrafts, setChipDrafts] = useState<Record<string, string>>({})
  const noteDraft = (key: string) => (draft: string) =>
    setChipDrafts((d) => (d[key] === draft ? d : { ...d, [key]: draft }))
  // "How we met" is a paragraph often enough to deserve the room.
  const howWeMetRef = useRef<HTMLTextAreaElement>(null)
  useGrow(howWeMetRef, form.howWeMet)
  // The rows this vault added for itself (§8.1), in form order.
  const customDefs = useMemo(() => activeFields(selectFieldDefs(records)), [records])
  const initialCustom = useMemo(() => draftFrom(customDefs, person), [customDefs, person])
  const [custom, setCustom] = useState<Record<string, DraftValue>>(initialCustom)
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({})
  const allPeople = useMemo(() => selectPeople(records), [records])
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
    JSON.stringify(form) !== JSON.stringify(initial) ||
    JSON.stringify(custom) !== JSON.stringify(initialCustom) ||
    isSelf !== Boolean(person.isSelf)

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
    <div className="span-2 field-label">
      <span id={`chip-label-${key}`} className={opts.hideLabel ? 'sr-only' : undefined}>
        {label}
      </span>
      <ChipInput
        label={label}
        labelId={`chip-label-${key}`}
        values={form[key]}
        onChange={(values) => setForm({ ...form, [key]: values })}
        onDraftChange={noteDraft(key)}
        suggestions={suggestions}
        capitalize={opts.capitalize}
        placeholder={opts.placeholder ?? 'one per entry'}
        suggestOnFocus={opts.suggestOnFocus}
      />
    </div>
  )

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    // A nonempty birthday that fails to parse is an error to show — never
    // silently dropped data (a lost birthday is exactly the kind of fact
    // this app exists to keep).
    const birthday = parsePartialDate(form.birthday)
    if (form.birthday.trim() && !birthday) {
      setDateError('Try a date like Jun 21 or 1984-06-21, or just June.')
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.facts-form input[aria-invalid="true"]')?.focus(),
      )
      return
    }
    setDateError(null)
    // Every custom date gets the same treatment as the birthday above: a
    // date you typed that we can't read is an error to show, never a
    // field quietly saved empty.
    const customValues: Record<string, CustomValue> = {}
    const dateErrors: Record<string, string> = {}
    for (const def of customDefs) {
      // A custom list row has the same leftover as the built-in ones.
      const draft =
        def.type === 'chips'
          ? withDraft(Array.isArray(custom[def.id]) ? (custom[def.id] as string[]) : [], chipDrafts[def.id])
          : custom[def.id]
      if (def.type === 'date') {
        const text = typeof draft === 'string' ? draft.trim() : ''
        if (!text) continue
        const parsed = parsePartialDate(text)
        if (!parsed) {
          dateErrors[def.id] = 'Try a date like Jun 21 or 1984-06-21, or just June.'
          continue
        }
        customValues[def.id] = parsed
        continue
      }
      if (def.type === 'number' && typeof draft === 'string') continue
      if (typeof draft === 'string' && !draft.trim()) continue
      if (draft !== undefined && hasValue(draft as CustomValue)) {
        customValues[def.id] = typeof draft === 'string' ? draft.trim() : (draft as CustomValue)
      }
    }
    if (Object.keys(dateErrors).length > 0) {
      setCustomErrors(dateErrors)
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.facts-form input[aria-invalid="true"]')?.focus(),
      )
      return
    }
    setCustomErrors({})
    // Answers to fields that have since retired are kept exactly as they
    // are: they are not on this form, so this form must not drop them.
    const retainedCustom: Record<string, CustomValue> = {}
    const onForm = new Set(customDefs.map((d) => d.id))
    for (const [id, value] of Object.entries(person.custom ?? {})) {
      if (!onForm.has(id)) retainedCustom[id] = value
    }
    const nextCustom = { ...retainedCustom, ...customValues }
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
        nicknames: withDraft(form.nicknames, chipDrafts.nicknames),
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
        likes: withDraft(form.likes, chipDrafts.likes),
        dislikes: withDraft(form.dislikes, chipDrafts.dislikes),
        tags: withDraft(form.tags, chipDrafts.tags),
        custom: Object.keys(nextCustom).length > 0 ? nextCustom : undefined,
        isSelf: isSelf || undefined,
      })
      // Circle chips are names; unknown names become new circles.
      const ids: string[] = []
      for (const name of withDraft(form.circles, chipDrafts.circles)) {
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

  const [askDiscard, setAskDiscard] = useState(false)
  const cancel = () => {
    if (dirty) {
      setAskDiscard(true)
      return
    }
    done()
  }
  // The Edit button vanished under us: say where we are.
  useEffect(() => {
    focusById('facts-form-title')
  }, [])

  return (
    <form className="facts-form" onSubmit={save}>
      <h2 className="form-title" id="facts-form-title" tabIndex={-1}>
        Edit {person.displayName}
      </h2>
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
          {chips('nicknames', 'Nicknames', undefined, { capitalize: 'words', placeholder: 'Danny' })}
          {field('pronouns', 'Pronouns')}
          {field('birthday', 'Birthday', 'Jun 21 or 1984-06-21', {
            onInput: () => setDateError(null),
            'aria-invalid': dateError ? true : undefined,
            'aria-describedby': dateError ? 'birthday-error' : undefined,
          })}
          {dateError && (
            <p className="field-error span-2" role="alert" id="birthday-error">
              {dateError}
            </p>
          )}
        </div>
        <label className="toggle-row">
        <input type="checkbox" checked={isSelf} onChange={(e) => setIsSelf(e.target.checked)} />
        <span>
          This is me
          <span className="hint desc">Tick it on your own card so “How you connect” knows where you are.</span>
        </span>
      </label>
      </fieldset>
      <fieldset className="field-group">
        <legend>Circles</legend>
        <p className="hint">
          Groups they belong to — a book club, a team, a family. They show on the graph.
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
              ref={howWeMetRef}
              className="grows"
              rows={2}
              value={form.howWeMet}
              onChange={(e) => setForm({ ...form, howWeMet: e.target.value })}
              placeholder="at Priya’s wedding"
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
          {chips('likes', 'Likes', vocab.likes, { placeholder: 'karaoke' })}
          {chips('dislikes', 'Dislikes', vocab.dislikes, { placeholder: 'small talk' })}
          {chips('tags', 'Tags', vocab.tags, { placeholder: 'college' })}
        </div>
      </fieldset>
      {customDefs.length > 0 && (
        <fieldset className="field-group">
          <legend>More details</legend>
          <CustomFieldInputs
            defs={customDefs}
            people={allPeople}
            draft={custom}
            onChange={(id, value) => setCustom((c) => ({ ...c, [id]: value }))}
            onChipDraft={(id, d) => noteDraft(id)(d)}
            errors={customErrors}
            clearError={(id) =>
              setCustomErrors((e) => {
                if (!(id in e)) return e
                const next = { ...e }
                delete next[id]
                return next
              })
            }
          />
        </fieldset>
      )}
      {/* Deleting lives in edit mode, not next to the everyday note box. */}
      <DangerConfirm
        className="delete-person"
        trigger="Delete this person"
        label="Delete"
        question={
          person.isSelf
            ? `Delete ${person.displayName}? This is your “me” card — “how you connect” stops working until you mark someone else as you.`
            : `Delete ${person.displayName} and everything about them? This cannot be undone.`
        }
        onConfirm={() => {
          void useVaultStore.getState().removePerson(person.id).then(() => navigate('/'))
        }}
      />
      <div className="form-actions">
        {askDiscard ? (
          <span className="confirm-row" role="group" aria-label="Discard your changes?">
            <span className="hint">Discard your changes?</span>
            <button type="button" className="danger" onClick={done} autoFocus>
              Discard
            </button>
            <button type="button" className="subtle" onClick={() => setAskDiscard(false)}>
              Keep editing
            </button>
          </span>
        ) : (
          <>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? '…' : 'Save'}
            </button>
            <button type="button" className="subtle" onClick={cancel}>
              Cancel
            </button>
          </>
        )}
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
  const { path, viaFormer } = useMemoPath(records, selfId, person.id)
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
          Tick “This is me” on your own entry first.
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
    const label = roleLabel(type?.label ?? 'linked', step.via!)
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
            See on graph ›
          </Link>
          {viaFormer && <span className="hint via-former">Through a former tie.</span>}
        </p>
      ) : (
        <p className="hint">No known path connects you yet.</p>
      )}
      <div className="row wrap">
        <div className="inline-check compare-with">
          <span className="field-label" aria-hidden="true">
            People you both know — compare with
          </span>
          <PersonPicker
            people={people}
            excludeIds={compareExclude}
            value={compareId}
            onChange={setCompareId}
            label="Compare with"
            placeholder="Type a name…"
            emptyLabel="You"
          />
        </div>
      </div>
      {mutuals.length === 0 ? (
        <p className="hint">
          No one in common.
        </p>
      ) : (
        <ul className="edges">
          {mutuals.map((m) => (
            <li key={m.person.id}>
              <Link to={`/person/${m.person.id}`}>{m.person.displayName}</Link>
              <span className="hint">
                {relOf(roleLabel(typeById.get(m.edgeToB.typeId)?.label ?? 'linked', m.edgeToB), person.displayName)} ·{' '}
                {relOf(roleLabel(typeById.get(m.edgeToA.typeId)?.label ?? 'linked', m.edgeToA), otherName)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** One role on a link: change its type, mark it former, date it, or
 * remove it. Dates take what the birthday field takes ("2019",
 * "Jun 2019", "2019-06-21"); an end date makes the role former. */
function RoleEditor({
  edge,
  other,
  text,
  types,
  onDone,
}: {
  edge: Relationship
  other: Person
  text: string
  types: { id: string; label: string }[]
  onDone: () => void
}) {
  const updateRelationship = useVaultStore((s) => s.updateRelationship)
  const removeRelationship = useVaultStore((s) => s.removeRelationship)
  const [typeId, setTypeId] = useState(edge.typeId)
  const [since, setSince] = useState(edge.startDate ? formatPartialDate(edge.startDate) : '')
  const [until, setUntil] = useState(edge.endDate ? formatPartialDate(edge.endDate) : '')
  const [dateError, setDateError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('select')?.focus()
  }, [])
  const commitDates = () => {
    const s = since.trim() ? parsePartialDate(since) : null
    const u = until.trim() ? parsePartialDate(until) : null
    if ((since.trim() && !s) || (until.trim() && !u)) {
      setDateError('Try a year, "Jun 2019", or 2019-06-21.')
      return
    }
    setDateError('')
    void updateRelationship(edge.id, {
      startDate: s,
      endDate: u,
      // An end date is the past tense; clearing it says nothing either way.
      former: u ? true : undefined,
    })
  }
  return (
    <div
      ref={rootRef}
      className="role-editor"
      role="group"
      aria-label={`${text} with ${other.displayName}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone()
        }
      }}
    >
      <label>
        Role
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Role">
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={Boolean(edge.former)}
          onChange={(e) => void updateRelationship(edge.id, { former: e.target.checked })}
        />
        Former
      </label>
      <label>
        Since
        <input
          value={since}
          onChange={(e) => setSince(e.target.value)}
          onBlur={commitDates}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDates()
            }
          }}
          placeholder="2019"
          aria-label="Since"
          aria-invalid={dateError ? true : undefined}
        />
      </label>
      <label>
        Until
        <input
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          onBlur={commitDates}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDates()
            }
          }}
          placeholder="2021"
          aria-label="Until"
          aria-invalid={dateError ? true : undefined}
        />
      </label>
      <span className="hint status-slot span-2" role="status">
        {dateError}
      </span>
      <div className="row wrap span-2">
        {typeId !== edge.typeId && (
          <button
            type="button"
            onClick={() => {
              void updateRelationship(edge.id, { typeId })
              onDone()
              focusById('relationships-heading')
            }}
          >
            Change role
          </button>
        )}
        <button type="button" className="quiet" onClick={onDone}>
          Done
        </button>
        <DangerConfirm
          className="role-remove"
          label="Remove"
          question={`Remove ${text} with ${other.displayName}?`}
          onConfirm={() => {
            void removeRelationship(edge.id)
            onDone()
            focusById('relationships-heading')
          }}
        />
      </div>
    </div>
  )
}

/** "How do I know X" walks current ties first; a former tie is the
 * answer only when nothing current connects you. */
function useMemoPath(
  records: ReturnType<typeof useVaultStore.getState>['records'],
  fromId: string,
  toId: string,
) {
  return useMemo(() => {
    if (!fromId) return { path: null, viaFormer: false }
    const current = shortestPath(records, fromId, toId)
    if (current) return { path: current, viaFormer: false }
    const any = shortestPath(records, fromId, toId, { includeFormer: true })
    return { path: any, viaFormer: Boolean(any) }
  }, [records, fromId, toId])
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

/** Land focus somewhere sensible after a control unmounts (2.4.3). */
function focusById(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus())
}

function CaptureBar({ person, hidden = false }: { person: Person; hidden?: boolean }) {
  const records = useVaultStore((s) => s.records)
  const saveNote = useVaultStore((s) => s.saveNote)
  const addPerson = useVaultStore((s) => s.addPerson)
  const registerDraft = useVaultStore((s) => s.registerDraft)
  const unregisterDraft = useVaultStore((s) => s.unregisterDraft)
  const stashDraft = useVaultStore((s) => s.stashDraft)
  // A draft left by following a link comes back with the page.
  const [draft, setDraft] = useState(() => useVaultStore.getState().drafts.get(person.id) ?? '')
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  // The note just saved, while its "Looks like people" offer is showing.
  const [offerNoteId, setOfferNoteId] = useState<string | null>(null)
  // Spoken confirmation, mounted from the start so it is announced.
  const [srSaved, setSrSaved] = useState('')
  const offering = useRef(false)
  offering.current = offerNoteId !== null
  const clearOffer = useCallback(() => setOfferNoteId(null), [])
  const suggestNames = useVaultStore((s) => selectSettings(s.records)?.nameSuggestions ?? true)
  const focusBox = useCallback(() => document.querySelector<HTMLElement>('.capture-bar textarea'), [])
  const draftRef = useRef('')
  draftRef.current = draft

  // Timer-driven locks flush this draft into an encrypted note instead of
  // eating it. Navigating away (tapping an @mention link remounts the
  // page) stashes it instead: a half sentence must not fossilise as a
  // dated note on every hop — it is waiting when you come back.
  useEffect(() => {
    stashDraft(person.id, '')
    registerDraft(person.id, () => draftRef.current)
    return () => {
      const leftover = draftRef.current.trim()
      // Guard against resurrection: if this unmount is the person being
      // DELETED, a stash would resurface for a dossier that no longer
      // exists.
      if (leftover && useVaultStore.getState().records.has(person.id)) {
        stashDraft(person.id, draftRef.current)
      }
      unregisterDraft(person.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, registerDraft, unregisterDraft])
  // …and it is kept on disk as it's typed, so a reload can't take it: an
  // update applying itself, iOS closing the app from the switcher, a
  // crash. A reload runs no lock and flushes nothing, so without this the
  // half-written note was simply gone. It waits in this box on unlock.
  const persistDraft = useVaultStore((s) => s.persistDraft)
  const persistTimer = useRef<number | undefined>(undefined)
  const flushPersist = useCallback(() => {
    if (persistTimer.current === undefined) return
    window.clearTimeout(persistTimer.current)
    persistTimer.current = undefined
    void persistDraft(person.id, draftRef.current)
  }, [persistDraft, person.id])
  useEffect(() => {
    if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current)
    persistTimer.current = undefined
    // Emptied — saved, or cleared by hand — is forgotten at once: a reload
    // in the next breath must not bring back a note that was just saved.
    if (!draft.trim()) {
      void persistDraft(person.id, '')
      return
    }
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = undefined
      void persistDraft(person.id, draftRef.current)
    }, 600)
  }, [draft, person.id, persistDraft])
  useEffect(() => {
    // Going away is when the last keystrokes matter most: write now,
    // don't wait for the pause.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPersist()
    }
    window.addEventListener('pagehide', flushPersist)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushPersist)
      document.removeEventListener('visibilitychange', onVisibility)
      flushPersist()
    }
  }, [flushPersist])
  const others = useMemo(
    () => selectPeople(records).filter((p) => p.id !== person.id),
    [records, person.id],
  )
  const isFresh = useMemo(
    () => selectNotes(records, person.id).length === 0 && !person.jobTitle,
    [records, person.id, person.jobTitle],
  )
  const save = async () => {
    // The box shows plain @Names; the note keeps links.
    const body = retokenize(draft.trim(), selectPeople(records))
    if (!body || busy) return
    setBusy(true)
    // Zero the ref synchronously so an unmount during the await can't
    // double-save this draft through the cleanup flush.
    draftRef.current = ''
    setDraft('')
    try {
      const note = await saveNote(person.id, body)
      // Only offer names when the setting is on and the note has some;
      // an offer still showing for the previous note stays until it is
      // dealt with.
      const found = suggestNames && note ? detectNames(body, selectPeople(records), person).length > 0 : false
      const offer = found && note ? note.id : null
      // A card with names still waiting stays; one showing only its Undo
      // status gives way to the new note's names.
      const chipsPending = Boolean(document.querySelector('.capture-bar .looks-like-chips'))
      setOfferNoteId((prev) => (prev && offering.current && chipsPending ? prev : offer))
      setSrSaved(
        offer
          ? 'Saved. Names found — the “Looks like people” group before the note box has buttons to add or link them.'
          : 'Saved',
      )
      window.setTimeout(() => setSrSaved(''), 4000)
      // Keyboard Save unmounts its own row: keep the caret in the box.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) document.querySelector<HTMLElement>('.capture-bar textarea')?.focus()
      })
      // "Saved" shows every time: in the Save row, or on the names card.
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
      <span className="sr-only" role="status">
        {srSaved}
      </span>
      {offerNoteId && (
        <LooksLikePeople
          key={offerNoteId}
          noteId={offerNoteId}
          person={person}
          onDone={clearOffer}
          refocus={focusBox}
          justSaved={savedFlash}
        />
      )}
      <MentionTextarea
        people={others}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void save()}
        onCreatePerson={addPerson}
        // The @ hint waits until there's a first note: to a newcomer it
        // means nothing yet.
        placeholder={isFresh ? `Jot a note about ${person.displayName.split(' ')[0]}…` : 'Jot something… @ links a person'}
        // The capture bar rides above the keyboard: it may grow, but not
        // until it is the whole screen.
        maxRows={6}
        plain
        autoFocus={isFresh}
        // One row when idle: the bar sits on the tab bar and shouldn't
        // spend a fifth of the screen before you've typed. Grows on focus
        // (CSS) and with content.
        rows={draft.trim() ? 3 : 1}
      />
      {/* The Save row appears only once there is something to save — an
          idle bar shouldn't spend two rows of bottom chrome. */}
      {(draft.trim() !== '' || (savedFlash && !offerNoteId) || busy) && (
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
          {savedFlash && !offerNoteId && (
            <span className="hint saved" role="status">
              Saved
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
  const [srNote, setSrNote] = useState('')

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    const dueDate = parsePartialDate(due)
    if (due.trim() && !dueDate) {
      setDueError('Try a date like Sep 20 or 2026-09-20.')
      return
    }
    setDueError(null)
    setBusy(true)
    try {
      await addFollowUp(personId, text.trim(), dueDate)
      setSrNote(`Added follow-up: ${text.trim()}`)
      window.setTimeout(() => setSrNote(''), 4000)
      setText('')
      setDue('')
    } finally {
      setBusy(false)
    }
  }

  const items = showDone ? [...open, ...doneItems] : open
  return (
    <section>
      <h2 id="followups-heading" tabIndex={-1}>
        Follow-ups
      </h2>
      <span className="sr-only" role="status">
        {srNote}
      </span>
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
              onClick={() => {
                void removeFollowUp(f.id)
                focusById('followups-heading')
              }}
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
      <form
        className="add-form"
        onSubmit={(e) => {
          void add(e)
          // The submit button disables itself once the text clears; keep
          // the caret in the field instead of dropping focus.
          focusById('followup-text')
        }}
      >
        <label className="span-2">
          New follow-up
          <input
            id="followup-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about…"
            aria-label="New follow-up"
          />
        </label>
        <label>
          <span>Due</span>
          <input
            className="due"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            placeholder="Sep 20"
            aria-invalid={dueError ? true : undefined}
            aria-describedby={dueError ? 'due-error' : undefined}
          />
        </label>
        <button type="submit" disabled={!text.trim() || busy}>
          Add follow-up
        </button>
        {dueError && (
          <p className="field-error span-2" role="alert" id="due-error">
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
  const updateRelationship = useVaultStore((s) => s.updateRelationship)
  const addRelationshipType = useVaultStore((s) => s.addRelationshipType)

  const people = useMemo(() => selectPeople(records), [records])
  const types = useMemo(
    () =>
      selectRelationshipTypes(records)
        // A retired type stops being offered for new ties; the ties that
        // already carry it keep it, and keep drawing (§8.2).
        .filter((t) => t.label !== 'mentioned' && !t.retired)
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

  const [srLinked, setSrLinked] = useState('')
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
  const [newTypeFamily, setNewTypeFamily] = useState<TypeFamily>('other')
  const [newTypeDirected, setNewTypeDirected] = useState(false)
  // For directed types: does the arrow point away from this person
  // ("I am the parent") or toward them ("they are my parent")?
  const [outward, setOutward] = useState(true)
  const [busy, setBusy] = useState(false)

  const selectedDirected =
    typeId === 'new' ? newTypeDirected : (typeById.get(typeId)?.directed ?? false)

  const [retype, setRetype] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const first = person.displayName.split(' ')[0]
  // One row per person, their roles side by side (§4.2: roles on a link).
  const groups = useMemo(() => {
    const byOther = new Map<string, Relationship[]>()
    for (const e of edges) {
      const otherId = e.fromId === person.id ? e.toId : e.fromId
      const list = byOther.get(otherId) ?? []
      list.push(e)
      byOther.set(otherId, list)
    }
    return [...byOther.entries()]
      .map(([otherId, list]) => ({ other: personById.get(otherId), list }))
      .filter((g): g is { other: Person; list: Relationship[] } => Boolean(g.other))
      .sort((a, b) => a.other.displayName.localeCompare(b.other.displayName))
  }, [edges, person.id, personById])
  // Read as a sentence, never as an arrow: "Sam is boss of Marcus" /
  // "June is parent of Marcus" / "former partner".
  const chipText = (edge: Relationship, other: Person) => {
    const type = typeById.get(edge.typeId)
    const outgoing = edge.fromId === person.id
    if (type?.directed) {
      // The row already names them: "parent of Marcus" reads as the row's
      // person being Marcus's parent; "boss of Priya" as Marcus being hers.
      const sentence = outgoing
        ? `${type.label} ${other.displayName.split(' ')[0]}`
        : `${type.label} ${first}`
      return edge.former ? `${sentence} (former)` : sentence
    }
    return roleLabel(type?.label ?? 'linked', edge)
  }
  const addRoleFor = (id: string) => {
    setOtherId(id)
    setTypeId('')
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('form.add-form select[aria-label="Relationship type"]')
        ?.focus(),
    )
  }
  const renderGroup = ({ other, list }: { other: Person; list: Relationship[] }) => {
    const explicit = list.filter((e) => e.origin !== 'mention')
    const mention = list.find((e) => e.origin === 'mention')
    const open = editing ? list.find((e) => e.id === editing) : undefined
    return (
      <li key={other.id} className={explicit.length === 0 ? 'mention-edge' : ''}>
        <div className="edge-row">
          <Link to={`/person/${other.id}`}>{other.displayName}</Link>
          <span className="roles">
            {explicit.map((edge) => {
              const type = typeById.get(edge.typeId)
              const text = chipText(edge, other)
              const when = roleDates(edge)
              return (
                <button
                  key={edge.id}
                  id={`role-chip-${edge.id}`}
                  type="button"
                  className={`role-chip ${edge.former ? 'former' : ''} ${editing === edge.id ? 'on' : ''}`}
                  style={{ '--edge-color': type?.color } as React.CSSProperties}
                  aria-expanded={editing === edge.id}
                  aria-label={`${text}${when ? `, ${when}` : ''} — edit`}
                  title={when || undefined}
                  onClick={() => setEditing((cur) => (cur === edge.id ? null : edge.id))}
                >
                  {text}
                </button>
              )
            })}
            {mention && (
              <span
                className="edge-type"
                style={{ '--edge-color': typeById.get(mention.typeId)?.color } as React.CSSProperties}
              >
                {mention.fromId === person.id ? 'mentioned in a note' : `mentioned ${first} in a note`}
              </span>
            )}
            {mention && explicit.length === 0 && (
            // A derived edge can't be deleted (the note still mentions them);
            // what it can do is become a real one (§4.2).
            <span className="edge-retype-group">
              <select
                className="edge-retype"
                aria-label={`Set relationship type with ${other.displayName}`}
                value={retype[mention.id] ?? ''}
                // Staged, then applied with the button: arrowing through a
                // closed select fires change per step on Windows.
                onChange={(e) => setRetype((m) => ({ ...m, [mention.id]: e.target.value }))}
              >
                <option value="">Relationship…</option>
                {types
                  .filter((t) => t.label !== 'mentioned')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
              </select>
              {retype[mention.id] && (
                <button
                  type="button"
                  className="subtle apply"
                  onClick={() => {
                    const id = retype[mention.id]
                    void (async () => {
                      await updateRelationship(mention.id, { typeId: id })
                      focusById('relationships-heading')
                    })()
                  }}
                  aria-label={`Apply type for ${other.displayName}`}
                >
                  Apply
                </button>
              )}
            </span>
            )}
          </span>
          {/* Third column, always present so the table's rows line up. */}
          {explicit.length > 0 ? (
            <button
              type="button"
              className="role-add"
              onClick={() => addRoleFor(other.id)}
              aria-label={`Add another role for ${other.displayName}`}
            >
              + role
            </button>
          ) : (
            <span className="role-slot" aria-hidden="true" />
          )}
        </div>
        {open && open.origin !== 'mention' && (
          <RoleEditor
            key={open.id}
            edge={open}
            other={other}
            text={chipText(open, other)}
            types={types}
            onDone={() => {
              setEditing(null)
              // Back to the chip that opened it, if it is still there.
              requestAnimationFrame(() => document.getElementById(`role-chip-${open.id}`)?.focus())
            }}
          />
        )}
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
        const created = await addRelationshipType(
          newType,
          TYPE_FAMILIES.find((f) => f.id === newTypeFamily)?.color ?? '',
          newTypeDirected,
          newTypeFamily,
        )
        resolvedTypeId = created.id
      }
      if (!resolvedTypeId) return
      const directed = typeById.get(resolvedTypeId)?.directed ?? newTypeDirected
      const [fromId, toId] =
        directed && !outward ? [otherId, person.id] : [person.id, otherId]
      await addRelationship(fromId, toId, resolvedTypeId)
      setSrLinked(
        `Linked ${personById.get(otherId)?.displayName ?? 'them'} as ${typeById.get(resolvedTypeId)?.label ?? newType.trim()}`,
      )
      window.setTimeout(() => setSrLinked(''), 4000)
      // Keep adding: the type stays selected and the caret returns to the
      // person field (quietly — no list until you type), so "Sam, Priya,
      // Theo — all coworkers" is name, Enter, Add, name, Enter, Add.
      setOtherId('')
      setTypeId(resolvedTypeId)
      setNewType('')
      setNewTypeFamily('other')
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
        <h2 id="relationships-heading" tabIndex={-1}>
          Relationships
        </h2>
        <Link to={`/graph?focus=${person.id}`}>See on graph ›</Link>
      </div>
      <span className="sr-only" role="status">
        {srLinked}
      </span>
      {/* The batch panel sits above the list so freshly linked rows
          appear right under its status line. */}
      {batchOpen && (
        <BatchAddPanel id="batch-add-links" anchor={person} headingLevel={3} onClose={closeBatch} />
      )}
      <ul className="edges roles-list">{groups.map(renderGroup)}</ul>
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
            // Enter on a chosen type links: "name, Enter, type, Enter".
            onKeyDown={(e) => {
              const v = e.currentTarget.value
              if (e.key === 'Enter' && otherId && v && v !== 'new') {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
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
            {/* Four hues, not a palette: the line's colour says which of
                life's corners this is; its dash tells types apart within one. */}
            <div className="row wrap">
              <span className="hint">Kind</span>
              <span className="family-picker" role="group" aria-label="Kind of relationship">
                {TYPE_FAMILIES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`chip ${f.id === newTypeFamily ? 'on' : ''}`}
                    style={{ '--chip-color': f.color } as React.CSSProperties}
                    aria-pressed={f.id === newTypeFamily}
                    onClick={() => setNewTypeFamily(f.id)}
                  >
                    {f.label}
                  </button>
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
        {/* Link comes first in the document so Tab reaches it before the
            batch toggle (it stays visually last, CSS order). */}
        <div className="row add-actions">
          <button
            className="add-submit"
            type="submit"
            disabled={busy || !otherId || !typeId || (typeId === 'new' && !newType.trim())}
          >
            Link
          </button>
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
            onRemove={() => void removePhoto(photo.id)}
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
      // Close is the only control: Tab must not reach the page beneath.
      if (e.key === 'Tab') {
        e.preventDefault()
        closeRef.current?.focus()
      }
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
        <DangerConfirm
          trigger="×"
          triggerClassName="subtle icon"
          triggerAriaLabel="Delete photo"
          label="Delete"
          question={photo.isAvatar ? 'Delete this photo? The next one becomes the avatar.' : 'Delete this photo?'}
          onConfirm={onRemove}
        />
      </div>
    </li>
  )
}

/** Promotable targets for note triage (§4.1 inbox model). */
const PROMOTE_TARGETS = [
  { id: 'like', label: 'Likes' },
  { id: 'dislike', label: 'Dislikes' },
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
  // A mention links only when its id is a person here: imported text can
  // carry the token shape, and a link to nowhere would look like a tie.
  const records = useVaultStore((s) => s.records)
  return (
    <p>
      {segmentBody(body).map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : records.get(seg.personId)?.kind !== 'person' ? (
          <span key={i}>@{seg.name}</span>
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
  // "Looks like people" after an inline edit — the way into notes written
  // before the feature existed (✎, Save).
  const [offerId, setOfferId] = useState<string | null>(null)
  const clearOffer = useCallback(() => setOfferId(null), [])
  const suggestNames = useVaultStore((s) => selectSettings(s.records)?.nameSuggestions ?? true)
  const owner = records.get(personId)
  const person = owner?.kind === 'person' ? owner : undefined

  return (
    <section>
      <h2 id="notes-heading" tabIndex={-1}>
        Notes
      </h2>
      {notes.length === 0 && (
        <p className="empty-inline">Nothing yet.</p>
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
                onDone={() => {
                  setEditingId(null)
                  focusById('notes-heading')
                }}
                onSaved={() => setOfferId(suggestNames ? note.id : null)}
              />
            ) : (
              <NoteBody body={note.body} />
            )}
            {offerId === note.id && editingId !== note.id && person && (
              <LooksLikePeople key={note.id} noteId={note.id} person={person} onDone={clearOffer} />
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
                  Add to Details…
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
                <DangerConfirm
                  trigger="×"
                  triggerClassName="subtle icon"
                  triggerAriaLabel="Delete note"
                  label="Delete"
                  question="Delete this note?"
                  onConfirm={() => {
                    void removeNote(note.id)
                    focusById('notes-heading')
                  }}
                />
              </div>
            )}
            {promotingId === note.id && editingId !== note.id && (
              <PromotePanel
                personId={personId}
                noteId={note.id}
                noteBody={note.body}
                onDone={() => {
                  setPromotingId(null)
                  focusById('notes-heading')
                }}
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
  onSaved,
}: {
  personId: string
  noteId: string
  body: string
  onDone: () => void
  onSaved?: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const updateNote = useVaultStore((s) => s.updateNote)
  const addPerson = useVaultStore((s) => s.addPerson)
  // Edit the readable form ("@Ivy Chen"), never the raw token with its
  // uuid; links are restored on save for every known name.
  const [draft, setDraft] = useState(() => plainText(body))
  const [busy, setBusy] = useState(false)
  const others = useMemo(
    () => selectPeople(records).filter((p) => p.id !== personId),
    [records, personId],
  )
  const save = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      const mentioned = segmentBody(body).flatMap((s) => (s.type === 'mention' ? [{ id: s.personId, displayName: s.name }] : []))
      const next = retokenize(draft.trim(), [...mentioned, ...selectPeople(records)])
      if (next !== body) await updateNote(noteId, next)
      onDone()
      onSaved?.()
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
  // No default: the first tap on Save must not file the sentence as a
  // like without a choice having been made.
  const [target, setTarget] = useState<PromoteTarget | ''>('')
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
    if (!value || !target) return
    setError(null)
    const next: Person = { ...person }
    switch (target) {
      case 'birthday': {
        const parsed = parsePartialDate(value)
        if (!parsed) {
          setError('Try a date like Jun 21 or 1984-06-21.')
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
      <p className="panel-title">Add to Details</p>
      <label>
        Which detail?
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as PromoteTarget | '')}
        >
          <option value="">Choose…</option>
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
