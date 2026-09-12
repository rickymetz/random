/**
 * "Looks like people": find name-shaped phrases in a note that point at
 * nobody yet (REQUIREMENTS.md §4.2 follow-up). Runs after a note is
 * saved so the composer stays quiet; the person decides per name.
 *
 * Heuristic, on purpose: a run of one to three capitalised words that is
 * not a stop word, not an acronym, not sentence-initial when a single
 * word (that is usually just a capitalised first word), and not already
 * an @mention. Whole-name or nickname matches against existing people
 * become "link" offers instead of "add" offers; a lone first name that
 * belongs to exactly one person links too.
 */
import type { Person } from './models'
import { mentionToken, segmentBody } from './mentions'

export interface NameCandidate {
  /** The phrase exactly as first typed (possessive and trailing punctuation removed). */
  phrase: string
  /** Set when the phrase resolves to someone already in the vault. */
  existing?: Person
}

const MAX_WORDS = 3
const MAX_CANDIDATES = 6

const STOP = new Set(
  `i i'm i'll i've i'd im ok okay yes no thanks lol omg btw fyi ps nb todo
   monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun
   january february march april may june july august september october november december
   jan feb mar apr jun jul aug sept sep oct nov dec
   today tomorrow tonight yesterday christmas xmas easter thanksgiving halloween ramadan eid diwali hanukkah
   spring summer autumn fall winter
   mr mrs ms mx dr prof sir madam
   google apple amazon netflix zoom slack teams uber lyft whatsapp instagram facebook tiktok youtube spotify linkedin twitter x
   god covid
   the a an and or but so if then when where what who why how this that these those
   new happy birthday hi hello hey dear love cheers`
    .split(/\s+/)
    .filter(Boolean),
)
const STOP_PHRASES = new Set(['new year', 'happy birthday', 'new years', 'new york'])
/** Words that never start a name, wherever they sit ("Hi Sam", "The Sam"). */
const LEAD = new Set(
  `the a an and or but so if then when where what who why how this that these those
   hi hello hey dear love cheers ok okay yes no thanks i i'm i'll i've i'd
   monday tuesday wednesday thursday friday saturday sunday`
    .split(/\s+/)
    .filter(Boolean),
)
/** Common capitalised sentence openers that swallow the name after them
 * ("Saw Theo Martins", "Lunch with" is split by the lowercase "with" already). */
const SENTENCE_LEAD = new Set(
  `saw met had have has went called talked spoke told asked gave got took ran sent texted emailed
   mentioned remember remind ask tell call text email note also then later today yesterday tomorrow
   lunch dinner coffee drinks breakfast birthday with at in on for from to about after before finally
   apparently follow followed check checked update updated heard found think thought need needs
   want wants said says saying let lets feel felt seems seemed looks looked great good nice fun big
   long quick first last next new old maybe probably definitely sure really just still even so
   invite invited visit visited meet meeting bring brought see seeing seen ping pinged`
    .split(/\s+/)
    .filter(Boolean),
)

const WORD_RE = /[\p{L}\p{N}'’.-]+/gu
const SENTENCE_BREAK = /[.!?:;\n\r("“'‘\-–—•]/

function cleanWord(w: string): string {
  return w.replace(/^['’.-]+/, '').replace(/(['’]s)?['’.,-]*$/u, '')
}

function isCapWord(w: string): boolean {
  if (!w) return false
  const first = w[0]
  if (!/\p{Lu}/u.test(first)) return false
  if (/\p{N}/u.test(w)) return false
  // Acronyms and shouting are not names ("NASA", "ASAP"); allow initials like "J.R."
  const letters = w.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase() && !w.includes('.')) return false
  return true
}

interface Match {
  person: Person
}

function buildLookup(people: Person[]) {
  const byName = new Map<string, Person>()
  const byFirst = new Map<string, Person[]>()
  for (const p of people) {
    const full = p.displayName.trim().toLowerCase()
    if (full && !byName.has(full)) byName.set(full, p)
    for (const n of p.nicknames) {
      const key = n.trim().toLowerCase()
      if (key && !byName.has(key)) byName.set(key, p)
    }
    const first = full.split(/\s+/)[0]
    if (first && first !== full) byFirst.set(first, [...(byFirst.get(first) ?? []), p])
  }
  return { byName, byFirst }
}

function resolve(
  phrase: string,
  lookup: ReturnType<typeof buildLookup>,
): Match | 'ambiguous' | undefined {
  const key = phrase.toLowerCase()
  const exact = lookup.byName.get(key)
  if (exact) return { person: exact }
  if (!key.includes(' ')) {
    const firsts = lookup.byFirst.get(key)
    if (firsts?.length === 1) return { person: firsts[0] }
    if (firsts && firsts.length > 1) return 'ambiguous'
  }
  return undefined
}

/**
 * Name-shaped phrases in `body` worth offering. `people` is everyone in
 * the vault; `self` is the dossier the note belongs to (its own name is
 * never offered — a note on Sam saying "Sam called" links nowhere new).
 */
export function detectNames(body: string, people: Person[], self?: Person): NameCandidate[] {
  const lookup = buildLookup(people)
  const seen = new Set<string>()
  const out: NameCandidate[] = []

  for (const seg of segmentBody(body)) {
    if (seg.type !== 'text') continue
    const text = seg.text
    // Words with positions, so we can tell "Sam Okafor" (a run) from
    // "Sam, Okafor" (two runs) and spot sentence starts.
    const words: { raw: string; start: number; end: number }[] = []
    for (const m of text.matchAll(WORD_RE)) {
      words.push({ raw: m[0], start: m.index, end: m.index + m[0].length })
    }
    let i = 0
    while (i < words.length) {
      const w = cleanWord(words[i].raw)
      const rawHasAt = text[words[i].start - 1] === '@' || text[words[i].start - 1] === '#'
      if (!isCapWord(w) || rawHasAt) {
        i++
        continue
      }
      // Extend the run over following capitalised words separated only by spaces.
      const run = [w]
      let j = i
      while (run.length < MAX_WORDS && j + 1 < words.length) {
        const between = text.slice(words[j].end, words[j + 1].start)
        const next = cleanWord(words[j + 1].raw)
        const prevEndsSentence = /[.!?,;:]$/.test(words[j].raw) && !/^\p{Lu}\.$/u.test(words[j].raw)
        if (!/^[ \t]+$/.test(between) || prevEndsSentence || !isCapWord(next) || STOP.has(next.toLowerCase())) break
        run.push(next)
        j++
      }
      const before = text.slice(0, words[i].start).replace(/[ \t]+$/, '')
      const sentenceStart = before === '' || SENTENCE_BREAK.test(before[before.length - 1])
      // Drop words that never start a name ("Hi Sam"), and at a sentence
      // start the capitalised opener too ("Saw Theo Martins" → Theo Martins).
      // Months stay: June Webb and May Chen are people.
      while (run.length && (LEAD.has(run[0].toLowerCase()) || (sentenceStart && SENTENCE_LEAD.has(run[0].toLowerCase())))) run.shift()
      const phrase = run.join(' ')
      const key = phrase.toLowerCase()
      const match = phrase ? resolve(phrase, lookup) : undefined
      const single = run.length === 1

      let keep = Boolean(phrase) && !STOP.has(key) && !STOP_PHRASES.has(key)
      if (keep && single && key.length < 2) keep = false
      if (keep && single && /^(mr|mrs|ms|mx|dr|prof|sir)$/i.test(phrase)) keep = false
      // A lone capitalised first word is usually just the start of a
      // sentence; keep it only when it names someone we know.
      if (keep && single && sentenceStart && (!match || match === 'ambiguous')) keep = false
      if (keep && match === 'ambiguous') keep = false
      if (keep && match && match !== 'ambiguous' && self && match.person.id === self.id) keep = false
      if (keep && self && key === self.displayName.trim().toLowerCase()) keep = false

      if (keep && !seen.has(key)) {
        seen.add(key)
        out.push(match && match !== 'ambiguous' ? { phrase, existing: match.person } : { phrase })
        if (out.length >= MAX_CANDIDATES) return out
      }
      i = j + 1
    }
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Rewrite every plain occurrence of `phrase` (outside existing mention
 * tokens, whole words, case-insensitive) into a mention of `person`.
 * Possessives survive: "Sam's" → "@[Sam Okafor](id)'s".
 */
export function linkPhrase(body: string, phrase: string, person: Pick<Person, 'id' | 'displayName'>): string {
  const token = mentionToken(person)
  const re = new RegExp(`(^|[^\\p{L}\\p{N}@])(${escapeRe(phrase).replace(/\\?\s+/g, '\\s+')})(?![\\p{L}\\p{N}])`, 'giu')
  return segmentBody(body)
    .map((seg) =>
      seg.type === 'mention'
        ? mentionToken({ id: seg.personId, displayName: seg.name })
        : seg.text.replace(re, (_m, pre: string) => `${pre}${token}`),
    )
    .join('')
}
