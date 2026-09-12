import { describe, expect, it } from 'vitest'
import type { Person } from './models'
import { mentionToken } from './mentions'
import { detectNames, linkPhrase } from './nameDetect'

const person = (displayName: string, nicknames: string[] = []): Person => ({
  kind: 'person',
  id: crypto.randomUUID(),
  displayName,
  nicknames,
  likes: [],
  dislikes: [],
  tags: [],
  createdAt: 0,
  updatedAt: 0,
})

const sam = person('Sam Okafor', ['Sammy'])
const priya = person('Priya Raman')
const people = [sam, priya]

describe('detectNames', () => {
  it('finds capitalised runs mid-sentence and offers them as new people', () => {
    const out = detectNames('Had lunch with Theo Martins and June Webb today.', people, sam)
    expect(out.map((c) => c.phrase)).toEqual(['Theo Martins', 'June Webb'])
    expect(out.every((c) => !c.existing)).toBe(true)
  })

  it('keeps multi-word names at a sentence start but drops lone capitalised first words', () => {
    const out = detectNames('Rosa Delgado called. Met her landlord. Great chat.', people)
    expect(out.map((c) => c.phrase)).toEqual(['Rosa Delgado'])
  })

  it('links a lone sentence-initial first name only when it belongs to one known person', () => {
    const out = detectNames('Priya called about the flat. Zed did not.', people, sam)
    expect(out).toHaveLength(1)
    expect(out[0].phrase).toBe('Priya')
    expect(out[0].existing?.id).toBe(priya.id)
  })

  it('resolves full names and nicknames to existing people', () => {
    const out = detectNames('Saw Sam Okafor and Sammy — wait, same person — with Bruno Costa', people)
    expect(out.map((c) => [c.phrase, c.existing?.id])).toEqual([
      ['Sam Okafor', sam.id],
      ['Sammy', sam.id],
      ['Bruno Costa', undefined],
    ])
  })

  it('never offers the dossier owner, existing @mentions, acronyms, dates or stop words', () => {
    const body = `${mentionToken(priya)} and Sam Okafor met at NASA on Friday in January. I think Monday works. Sam's idea.`
    const out = detectNames(body, people, sam)
    expect(out).toEqual([])
  })

  it('offers a choice for an ambiguous first name mid-sentence, drops it at a sentence start, dedupes', () => {
    const reyes = person('Sam Reyes')
    const twoSams = [...people, reyes]
    const out = detectNames('Sam came by with Theo. Later theo left, then Sam again.', twoSams)
    expect(out.map((c) => c.phrase)).toEqual(['Theo', 'Sam'])
    expect(out[1].options?.map((p) => p.id)).toEqual([sam.id, reyes.id])
    expect(detectNames('Sam came by.', twoSams)).toEqual([])
  })

  it('handles curly apostrophes, particles, dotted titles and initials', () => {
    const out = detectNames(
      "I’m told Jan van der Berg and Dr. Patel met J.R. Smith and O’Brien too, and Sam’s here.",
      [person("Aoife O'Brien")],
    )
    expect(out.map((c) => [c.phrase, c.existing?.displayName])).toEqual([
      ['Jan van der Berg', undefined],
      ['Dr. Patel', undefined],
      ['J.R. Smith', undefined],
      ['O’Brien', undefined],
      ['Sam', undefined],
    ])
  })

  it('links a stop-word first name that is really someone and strips brand/holiday heads', () => {
    const june = person('June Webb')
    const out = detectNames('June called. Bought an Apple Watch on Christmas Eve with Amazon Prime. Using Ledger daily.', [june])
    expect(out.map((c) => [c.phrase, c.existing?.id])).toEqual([['June', june.id]])
  })

  it('drops -ing/-ed sentence openers and address fragments', () => {
    const out = detectNames(
      'Texting Theo Martins later. Chased Rosa Delgado. See github.com/Foo/Bar or Anna.Smith@Example.com or #Priya',
      [],
    )
    expect(out.map((c) => c.phrase)).toEqual(['Theo Martins', 'Rosa Delgado'])
  })

  it('splits runs on commas and keeps titles', () => {
    const out = detectNames('Cc Dr Patel, Amara Osei and Mr Big', [], undefined)
    expect(out.map((c) => c.phrase)).toEqual(['Dr Patel', 'Amara Osei', 'Mr Big'])
  })

  it('strips sentence openers and greetings but keeps month first names', () => {
    const out = detectNames('Saw Theo Martins at the gym. Hi June Webb! Lunch with May Chen.', people)
    expect(out.map((c) => c.phrase)).toEqual(['Theo Martins', 'June Webb', 'May Chen'])
  })

  it('caps the offer at eight names', () => {
    const body = 'With Ann Bee, Cal Dee, Eve Eff, Gus Hay, Ivy Jay, Kim Lee, Max Nye, Odd Pip and Uma Vee.'
    expect(detectNames(body, [])).toHaveLength(8)
  })
})

describe('linkPhrase', () => {
  it('rewrites whole-word, same-case occurrences into mention tokens and keeps possessives', () => {
    const out = linkPhrase("Theo's plan: Theo and Theodora meet theo, Theo-Ann and #Theo later.", 'Theo', sam)
    const t = mentionToken(sam)
    expect(out).toBe(`${t}'s plan: ${t} and Theodora meet theo, Theo-Ann and #Theo later.`)
  })

  it('does not swallow common words that share a name, and matches curly apostrophes', () => {
    const mark = person('Mark Hale')
    expect(linkPhrase('Mark said mark it down.', 'Mark', mark)).toBe(`${mentionToken(mark)} said mark it down.`)
    const ob = person("Aoife O'Brien")
    expect(linkPhrase("O'Brien and O’Brien", "O'Brien", ob)).toBe(`${mentionToken(ob)} and ${mentionToken(ob)}`)
  })

  it('links names in scripts without case', () => {
    const li = person('李雷')
    expect(linkPhrase('李雷来了 李雷雷', '李雷', li)).toBe(`${mentionToken(li)}来了 ${mentionToken(li)}雷`)
  })

  it('leaves existing tokens alone and matches across whitespace', () => {
    const body = `${mentionToken(priya)} met Theo  Martins`
    const out = linkPhrase(body, 'Theo Martins', sam)
    expect(out).toBe(`${mentionToken(priya)} met ${mentionToken(sam)}`)
  })
})
