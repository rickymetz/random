/**
 * Mention tokens in note bodies (REQUIREMENTS.md §4.2).
 *
 * A mention is stored inline as `@[Display Name](person-id)`. The display
 * name is a snapshot for readability; the id is authoritative. Mentions
 * feed the graph as derived edges: sync logic lives in the store.
 */
import type { Person } from './models'

const MENTION_RE = /@\[([^\]]*)\]\(([0-9a-fA-F-]{36})\)/g

export function mentionToken(person: Pick<Person, 'id' | 'displayName'>): string {
  // Strip characters that would break the token syntax.
  const name = person.displayName.replace(/[[\]()]/g, '')
  return `@[${name}](${person.id})`
}

/** Unique person ids mentioned in a note body, in order of appearance. */
export function extractMentions(body: string): string[] {
  const ids: string[] = []
  for (const match of body.matchAll(MENTION_RE)) {
    const id = match[2].toLowerCase()
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export type NoteSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; name: string; personId: string }

/** Split a body into text and mention segments for rendering. */
export function segmentBody(body: string): NoteSegment[] {
  const segments: NoteSegment[] = []
  let last = 0
  for (const match of body.matchAll(MENTION_RE)) {
    if (match.index > last) segments.push({ type: 'text', text: body.slice(last, match.index) })
    segments.push({ type: 'mention', name: match[1], personId: match[2].toLowerCase() })
    last = match.index + match[0].length
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) })
  return segments
}

/** Body with mention tokens flattened to plain names, for search indexing. */
export function plainText(body: string): string {
  return body.replace(MENTION_RE, (_m, name: string) => `@${name}`)
}

/**
 * Flatten mention tokens pointing at one person into their plain name —
 * used when that person is deleted, so surviving notes keep the readable
 * name instead of a dead link (§4.2).
 */
export function stripMentionsOf(body: string, personId: string): string {
  return body.replace(MENTION_RE, (match, name: string, id: string) =>
    id.toLowerCase() === personId.toLowerCase() ? name : match,
  )
}

/**
 * Turn plain "@Name" back into tokens for every known person (longest
 * names first, existing tokens untouched) — the note editor shows
 * `@Ivy Chen`, not `@[Ivy Chen](uuid)`, and this restores the links on save.
 */
export function retokenize(text: string, people: Pick<Person, 'id' | 'displayName'>[]): string {
  const sorted = [...people]
    .filter((p) => p.displayName.trim())
    .sort((a, b) => b.displayName.length - a.displayName.length)
  return segmentBody(text)
    .map((seg) => {
      if (seg.type === 'mention') return mentionToken({ id: seg.personId, displayName: seg.name })
      let out = seg.text
      for (const p of sorted) {
        const name = p.displayName.replace(/[[\]()]/g, '').trim()
        const re = new RegExp(`@(?!\\[)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu')
        out = out.replace(re, mentionToken(p))
      }
      return out
    })
    .join('')
}

/** Rewrite the display text of every token pointing at `personId`
 * (renames should not leave stale "@Old Name" labels in other people's
 * notes; the id keeps the link itself intact either way). */
export function renameMentionsOf(body: string, personId: string, newName: string): string {
  return body.replace(MENTION_RE, (match, _name: string, id: string) =>
    id === personId ? mentionToken({ id, displayName: newName }) : match,
  )
}
