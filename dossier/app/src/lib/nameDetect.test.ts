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

  it('skips ambiguous lone first names and dedupes case-insensitively', () => {
    const twoSams = [...people, person('Sam Reyes')]
    const out = detectNames('Sam came by with Theo. Later theo left, then Sam again.', twoSams)
    expect(out.map((c) => c.phrase)).toEqual(['Theo'])
  })

  it('splits runs on commas and keeps titles', () => {
    const out = detectNames('Cc Dr Patel, Amara Osei and Mr Big', [], undefined)
    expect(out.map((c) => c.phrase)).toEqual(['Dr Patel', 'Amara Osei', 'Mr Big'])
  })

  it('strips sentence openers and greetings but keeps month first names', () => {
    const out = detectNames('Saw Theo Martins at the gym. Hi June Webb! Lunch with May Chen.', people)
    expect(out.map((c) => c.phrase)).toEqual(['Theo Martins', 'June Webb', 'May Chen'])
  })

  it('caps the offer at six names', () => {
    const body = 'With Ann Bee, Cal Dee, Eve Eff, Gus Hay, Ivy Jay, Kim Lee, Max Nye and Odd Pip.'
    expect(detectNames(body, [])).toHaveLength(6)
  })
})

describe('linkPhrase', () => {
  it('rewrites whole-word occurrences into mention tokens and keeps possessives', () => {
    const out = linkPhrase("Theo's plan: Theo and Theodora meet theo later.", 'Theo', sam)
    const t = mentionToken(sam)
    expect(out).toBe(`${t}'s plan: ${t} and Theodora meet ${t} later.`)
  })

  it('leaves existing tokens alone and matches across whitespace', () => {
    const body = `${mentionToken(priya)} met Theo  Martins`
    const out = linkPhrase(body, 'Theo Martins', sam)
    expect(out).toBe(`${mentionToken(priya)} met ${mentionToken(sam)}`)
  })
})
