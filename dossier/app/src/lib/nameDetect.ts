/**
 * "Looks like people": find name-shaped phrases in a note that point at
 * nobody yet (REQUIREMENTS.md §4.2). Runs after a note is saved so the
 * composer stays quiet; the person decides per name. Pure, on-device.
 *
 * Heuristic, on purpose: a run of capitalised words (lowercase particles
 * like "van der" allowed between them) that is not a stop word, not an
 * acronym, not sentence-initial when a single word (that is usually just
 * a capitalised first word), and not already an @mention. Whole-name or
 * nickname matches against existing people become "link" offers instead
 * of "add" offers; a lone first name that belongs to exactly one person
 * links too, and one shared by several offers a choice.
 */
import type { Person } from './models'
import { mentionToken, segmentBody } from './mentions'

export interface NameCandidate {
  /** The phrase exactly as first typed (possessive and trailing punctuation removed). */
  phrase: string
  /** Set when the phrase resolves to exactly one existing person. */
  existing?: Person
  /** Set when a lone first name belongs to several people: pick one. */
  options?: Person[]
}

const MAX_WORDS = 4
const MAX_CANDIDATES = 8

const words = (s: string) => s.split(/\s+/).filter(Boolean)

/** Months and their short forms double as first names (June Webb, Jan van der Berg). */
const MONTHS = new Set(
  words('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'),
)
const TITLES = /^(mr|mrs|ms|mx|dr|prof|sir|st|jr|sr)\.?$/i

const STOP = new Set(
  words(`i i'm i'll i've i'd im ok okay yes no thanks lol omg btw fyi ps nb todo asap
   monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun
   jan feb mar apr jun jul aug sept sep oct nov dec
   today tomorrow tonight yesterday christmas xmas easter thanksgiving halloween ramadan eid diwali hanukkah
   spring summer autumn fall winter
   mr mrs ms mx dr prof sir madam
   google apple amazon netflix zoom slack teams uber lyft whatsapp instagram facebook tiktok youtube spotify
   linkedin twitter x gmail outlook iphone android chrome safari ledger dossier
   god covid
   the a an and or but so if then when where what who why how this that these those
   new happy birthday hi hello hey dear love cheers`).concat([...MONTHS]),
)
const STOP_PHRASES = new Set(['new year', 'happy birthday', 'new years', 'new york', 'new york city', 'new year’s', "new year's"])
/** Words that never start a name, wherever they sit ("Hi Sam", "The Sam"). */
const LEAD = new Set(
  words(`the a an and or but so if then when where what who why how this that these those
   hi hello hey dear love cheers ok okay yes no thanks i i'm i'll i've i'd
   monday tuesday wednesday thursday friday saturday sunday`),
)
/** Common capitalised sentence openers that swallow the name after them
 * ("Saw Theo Martins"). Lowercase "with" already splits "Lunch with". */
const SENTENCE_LEAD = new Set(
  words(`saw met had have has went called talked spoke told asked gave got took ran sent texted emailed
   mentioned remember remind ask tell call text email note also then later today yesterday tomorrow
   lunch dinner coffee drinks breakfast birthday with at in on for from to about after before finally
   apparently follow followed check checked update updated heard found think thought need needs
   want wants said says saying let lets feel felt seems seemed looks looked great good nice fun big
   long quick first last next new old maybe probably definitely sure really just still even so
   invite invited visit visited meet meeting bring brought see seeing seen ping pinged
   loves likes hates love like hate texting calling emailing visiting telling asking using use used
   book booked booking flying flew moved moving chased chasing helped helping thanked thank
   dropped drop picked pick joined join left ran running walked walking drove driving`),
)
/** Lowercase name particles allowed inside a run: "Jan van der Berg". */
const PARTICLES = new Set(words('van von der den de da di du del della la le bin ibn al el ter y e'))

const WORD_RE = /[\p{L}\p{N}'’.-]+/gu
const SENTENCE_BREAK = /[.!?:;\n\r("“'‘\-–—•]/

const norm = (s: string) => s.replace(/’/g, "'").toLowerCase()

function cleanWord(w: string): string {
  const core = w.replace(/^['’.-]+/, '')
  // "J.R." and "Dr." keep their dot; everything else sheds trailing punctuation and possessives.
  if (isAbbrev(core)) return core
  return core.replace(/(['’]s)?['’.,-]*$/u, '')
}

function isCapWord(w: string): boolean {
  if (!w) return false
  if (!/\p{Lu}/u.test(w[0])) return false
  if (/\p{N}/u.test(w)) return false
  // "Anna.Smith", "Example.org": dotted joins are addresses, not names (initials "J.R." are fine).
  if (/\p{L}{2,}\.\p{L}/u.test(w)) return false
  // Acronyms and shouting are not names ("NASA", "ASAP"); allow initials like "J.R."
  const letters = w.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase() && !w.includes('.')) return false
  return true
}

/** "Dr." / "J.R." / "St." end a word, not a sentence. */
function isAbbrev(raw: string): boolean {
  return /^(\p{Lu}\.)+$/u.test(raw) || TITLES.test(raw)
}

type Lookup = ReturnType<typeof buildLookup>

function buildLookup(people: Person[]) {
  const byName = new Map<string, Person>()
  const byFirst = new Map<string, Person[]>()
  for (const p of people) {
    const full = norm(p.displayName.trim())
    if (full && !byName.has(full)) byName.set(full, p)
    for (const n of p.nicknames) {
      const key = norm(n.trim())
      if (key && !byName.has(key)) byName.set(key, p)
    }
    const first = full.split(/\s+/)[0]
    if (first && first !== full) byFirst.set(first, [...(byFirst.get(first) ?? []), p])
  }
  return { byName, byFirst }
}

type Match = { person: Person } | { options: Person[] } | undefined

function resolve(phrase: string, lookup: Lookup): Match {
  const key = norm(phrase)
  const exact = lookup.byName.get(key)
  if (exact) return { person: exact }
  if (!key.includes(' ')) {
    const firsts = lookup.byFirst.get(key)
    if (firsts?.length === 1) return { person: firsts[0] }
    if (firsts && firsts.length > 1) return { options: firsts }
  }
  return undefined
}

const isPerson = (m: Match): m is { person: Person } => Boolean(m && 'person' in m)

/**
 * Name-shaped phrases in `body` worth offering. `people` is everyone in
 * the vault; `self` is the dossier the note belongs to (its own name is
 * never offered — a note on Sam saying "Sam called" links nowhere new).
 */
export function detectNames(body: string, people: Person[], self?: Person): NameCandidate[] {
  const lookup = buildLookup(people)
  const selfKeys = new Set(self ? [self.displayName, ...self.nicknames].map((n) => norm(n.trim())) : [])
  const seen = new Set<string>()
  const out: NameCandidate[] = []

  for (const seg of segmentBody(body)) {
    if (seg.type !== 'text') continue
    const text = seg.text
    // Words with positions, so we can tell "Sam Okafor" (a run) from
    // "Sam, Okafor" (two runs) and spot sentence starts.
    const toks: { raw: string; start: number; end: number }[] = []
    for (const m of text.matchAll(WORD_RE)) {
      toks.push({ raw: m[0], start: m.index, end: m.index + m[0].length })
    }
    let i = 0
    while (i < toks.length) {
      const w = cleanWord(toks[i].raw)
      // Fragments of handles, tags, paths and addresses: "@sam", "#Theo", "github.com/Foo".
      const glued = /[@#/.:]/.test(text[toks[i].start - 1] ?? '')
      if (!isCapWord(w) || glued) {
        i++
        continue
      }
      // Extend the run over following capitalised words separated only by
      // spaces, hopping over lowercase particles when a capitalised word follows.
      const run = [w]
      let j = i
      while (run.length < MAX_WORDS && j + 1 < toks.length) {
        const gap = (a: number, b: number) => /^[ \t]+$/.test(text.slice(toks[a].end, toks[b].start))
        const endsSentence = /[.!?,;:]$/.test(toks[j].raw) && !isAbbrev(toks[j].raw)
        if (!gap(j, j + 1) || endsSentence) break
        const next = cleanWord(toks[j + 1].raw)
        if (isCapWord(next) && !STOP.has(norm(next))) {
          run.push(next)
          j++
          continue
        }
        // "Jan van der Berg": one or more particles, then a capitalised word.
        let k = j + 1
        while (k < toks.length && PARTICLES.has(norm(toks[k].raw)) && gap(k - 1, k)) k++
        const after = k > j + 1 && k < toks.length && gap(k - 1, k) ? cleanWord(toks[k].raw) : ''
        if (after && isCapWord(after) && !STOP.has(norm(after)) && run.length + (k - j) <= MAX_WORDS) {
          for (let t = j + 1; t < k; t++) run.push(toks[t].raw)
          run.push(after)
          j = k
          continue
        }
        break
      }
      const before = text.slice(0, toks[i].start).replace(/[ \t]+$/, '')
      const sentenceStart = before === '' || SENTENCE_BREAK.test(before[before.length - 1])
      // Drop words that never start a name ("Hi Sam"), stop words other than
      // months ("Amazon Prime", "Christmas Eve"; June Webb and May Chen are
      // people), and at a sentence start the capitalised opener too ("Saw
      // Theo Martins", "Texting Theo") — unless the whole run is someone we know.
      const known = (r: string[]) => isPerson(resolve(r.join(' '), lookup))
      while (run.length > 1 && !known(run)) {
        const head = norm(run[0])
        if (STOP.has(head) && !MONTHS.has(head) && !TITLES.test(run[0]) && !LEAD.has(head)) {
          // "Apple Watch", "Christmas Eve": a product or a holiday, not a person.
          run.length = 0
          break
        }
        const opener =
          sentenceStart &&
          (SENTENCE_LEAD.has(head) || (head.length > 4 && /(ing|ed)$/.test(head) && !TITLES.test(run[0])))
        if (LEAD.has(head) || opener) {
          run.shift()
          continue
        }
        break
      }
      const phrase = run.join(' ')
      const key = norm(phrase)
      const match = phrase ? resolve(phrase, lookup) : undefined
      const single = run.length === 1

      let keep = Boolean(phrase) && !STOP_PHRASES.has(key)
      // A stop word only counts when it is actually someone's name ("June called").
      if (keep && STOP.has(key) && !isPerson(match)) keep = false
      if (keep && LEAD.has(key)) keep = false
      if (keep && single && (key.length < 2 || TITLES.test(phrase))) keep = false
      // A lone capitalised first word is usually just the start of a
      // sentence; keep it only when it names someone we know.
      if (keep && single && sentenceStart && !isPerson(match)) keep = false
      if (keep && isPerson(match) && self && match.person.id === self.id) keep = false
      if (keep && selfKeys.has(key)) keep = false

      if (keep && !seen.has(key)) {
        seen.add(key)
        out.push(
          !match ? { phrase } : 'person' in match ? { phrase, existing: match.person } : { phrase, options: match.options },
        )
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

const hasCase = (c: string) => /\p{Lu}|\p{Ll}/u.test(c)

/**
 * Rewrite every plain occurrence of `phrase` (outside existing mention
 * tokens, whole words, exact case — "Mark" must not swallow "mark it
 * down") into a mention of `person`. Straight and curly apostrophes match
 * each other; possessives survive: "Sam's" → "@[Sam Okafor](id)'s".
 */
export function linkPhrase(body: string, phrase: string, person: Pick<Person, 'id' | 'displayName'>): string {
  const token = mentionToken(person)
  const core = escapeRe(phrase.trim())
    .replace(/\s+/g, '\\s+')
    .replace(/['’]/g, "['’]")
  // Scripts without case have no word boundary to speak of: match the
  // characters themselves ("李雷来了").
  const pre = hasCase(phrase[0]) ? '(^|[^\\p{L}\\p{N}@#_-])' : '(^|[^@#])'
  const post = hasCase(phrase[phrase.length - 1]) ? '(?![\\p{L}\\p{N}_-])' : ''
  const re = new RegExp(`${pre}(${core})${post}`, 'gu')
  return segmentBody(body)
    .map((seg) =>
      seg.type === 'mention'
        ? mentionToken({ id: seg.personId, displayName: seg.name })
        : seg.text.replace(re, (_m, p: string) => `${p}${token}`),
    )
    .join('')
}
