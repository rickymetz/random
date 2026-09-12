import { describe, expect, it } from 'vitest'
import type { Person } from './models'
import { matchContacts, parseContacts, parseCsv, parseCsvRows, parseVCard, parseVCardDate } from './contacts'

const person = (displayName: string, extra: Partial<Person> = {}): Person => ({
  kind: 'person',
  id: crypto.randomUUID(),
  displayName,
  nicknames: [],
  likes: [],
  dislikes: [],
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
})

const APPLE_VCF = `BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//iPhone OS 17.0//EN
N:Okafor;Sam;;Dr.;
FN:Dr. Sam Okafor
NICKNAME:Sammy
ORG:Acme Ltd;Design
TITLE:Head of Design
item1.EMAIL;type=INTERNET;type=pref:Sam.Okafor@Example.com
TEL;type=HOME;type=VOICE:+44 20 7946 0000
TEL;type=CELL;type=VOICE:+44 7700 900123
item2.ADR;type=HOME;type=pref:;;12 High St;Brighton;;BN1 1AA;United Kingdom
BDAY;X-APPLE-OMIT-YEAR=1604:1604-06-12
NOTE:Met at the\\, conference.\\nLoves climbing.
END:VCARD
BEGIN:VCARD
VERSION:2.1
N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=C3=98rn;Zo=C3=AB;;;
TEL;CELL:0700 000 001
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Priya Raman
BDAY:19900301
EMAIL:priya@example.org
END:VCARD
BEGIN:VCARD
VERSION:3.0
ORG:Just A Company
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:
END:VCARD
`

describe('parseVCard', () => {
  it('reads Apple, 2.1 quoted-printable and 4.0 cards', () => {
    const [sam, zoe, priya, company] = parseVCard(APPLE_VCF)
    expect(sam).toEqual({
      displayName: 'Dr. Sam Okafor',
      nicknames: ['Sammy'],
      jobTitle: 'Head of Design',
      employer: 'Acme Ltd',
      location: 'Brighton, United Kingdom',
      birthday: { month: 6, day: 12 },
      contact: { phone: '+44 7700 900123', email: 'sam.okafor@example.com' },
      note: 'Met at the, conference.\nLoves climbing.',
    })
    expect(zoe).toEqual({ displayName: 'Zoë Ørn', contact: { phone: '0700 000 001' } })
    expect(priya).toEqual({
      displayName: 'Priya Raman',
      birthday: { year: 1990, month: 3, day: 1 },
      contact: { email: 'priya@example.org' },
    })
    expect(company).toEqual({ displayName: 'Just A Company' })
    expect(parseVCard(APPLE_VCF)).toHaveLength(4)
  })

  it('unfolds long lines and handles CRLF', () => {
    const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Theo Mart\r\n ins\r\nEMAIL:theo@\r\n example.com\r\nEND:VCARD\r\n'
    expect(parseVCard(text)).toEqual([{ displayName: 'Theo Martins', contact: { email: 'theo@example.com' } }])
  })

  it('joins 2.1 quoted-printable soft line breaks, ranks PREF=n and cleans tel: URIs', () => {
    const text =
      'BEGIN:VCARD\r\nVERSION:2.1\r\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=\r\n=BCller;J=C3=BCrgen;;;\r\n' +
      'PHOTO;ENCODING=BASE64;TYPE=JPEG:AAAA=\r\n\r\nEND:VCARD\r\n' +
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ann Lee\r\nEMAIL;PREF=2:second@example.org\r\nEMAIL;PREF=1:first@example.org\r\n' +
      'TEL;VALUE=uri;TYPE=cell:tel:+1-555-0100;ext=42\r\nEND:VCARD\r\n'
    const [jurgen, ann] = parseVCard(text)
    expect(jurgen.displayName).toBe('Jürgen Müller')
    expect(ann.contact).toEqual({ email: 'first@example.org', phone: '+1-555-0100 ext. 42' })
  })

  it('parses birthday forms', () => {
    expect(parseVCardDate('1985-06-12')).toEqual({ year: 1985, month: 6, day: 12 })
    expect(parseVCardDate('19850612')).toEqual({ year: 1985, month: 6, day: 12 })
    expect(parseVCardDate('--0612')).toEqual({ month: 6, day: 12 })
    expect(parseVCardDate('--06-12')).toEqual({ month: 6, day: 12 })
    expect(parseVCardDate('1604-06-12')).toEqual({ month: 6, day: 12 })
    expect(parseVCardDate('20240230')).toBeUndefined()
    expect(parseVCardDate('nope')).toBeUndefined()
  })
})

describe('parseCsv', () => {
  it('parses quoted fields, embedded newlines and a BOM', () => {
    expect(parseCsvRows('﻿a,"b,c","d ""e""\nf"\r\n1,2,3\n\n')).toEqual([
      ['a', 'b,c', 'd "e"\nf'],
      ['1', '2', '3'],
    ])
  })

  it('reads a Google Contacts export', () => {
    const csv =
      'Name,Given Name,Additional Name,Family Name,Nickname,Birthday,Notes,Organization 1 - Name,Organization 1 - Title,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value,Address 1 - City,Address 1 - Country\n' +
      'Sam Okafor,Sam,,Okafor,Sammy,1985-06-12,Climber,Acme Ltd,Head of Design,* ,sam@example.com ::: sam2@example.com,Mobile,+44 7700 900123,Brighton,UK\n' +
      ',Priya,,Raman,,--03-01,,,,,,,,,\n' +
      ',,,,,,,,,,,,,,\n'
    const [sam, priya] = parseCsv(csv)
    expect(sam).toEqual({
      displayName: 'Sam Okafor',
      nicknames: ['Sammy'],
      jobTitle: 'Head of Design',
      employer: 'Acme Ltd',
      location: 'Brighton, UK',
      birthday: { year: 1985, month: 6, day: 12 },
      contact: { phone: '+44 7700 900123', email: 'sam@example.com' },
      note: 'Climber',
    })
    expect(priya).toEqual({ displayName: 'Priya Raman', birthday: { month: 3, day: 1 } })
    expect(parseCsv(csv)).toHaveLength(2)
  })

  it('keeps Outlook honorifics out of the job title, validates d/m dates, skips label columns, reads ; files', () => {
    const outlook = 'First Name,Last Name,Title,Company,Job Title,E-mail Address,E-mail Type,Mobile Phone,Birthday\nTheo,Martins,Mr.,Beta Co,Engineer,theo@example.com,SMTP,\'07700 900456,13/12/1985\nJune,Webb,Ms.,,,,SMTP,,31/01/1990\n'
    const [theo, june] = parseCsv(outlook)
    expect(theo).toEqual({
      displayName: 'Theo Martins',
      jobTitle: 'Engineer',
      employer: 'Beta Co',
      birthday: { year: 1985, month: 12, day: 13 },
      contact: { phone: '07700 900456', email: 'theo@example.com' },
    })
    expect(june).toEqual({ displayName: 'June Webb', birthday: { year: 1990, month: 1, day: 31 } })
    expect(parseCsv('name;email\nAna Silva;ana@example.com\n')).toEqual([
      { displayName: 'Ana Silva', contact: { email: 'ana@example.com' } },
    ])
    expect(parseCsv('Name,Birthday\nX,31/31/1990\n')).toEqual([{ displayName: 'X' }])
  })

  it('reads an Outlook export and a generic sheet', () => {
    const outlook = 'First Name,Last Name,Company,Job Title,E-mail Address,Mobile Phone,Birthday\nTheo,Martins,Beta Co,Engineer,theo@example.com,07700 900456,6/12/1985\n'
    expect(parseCsv(outlook)).toEqual([
      {
        displayName: 'Theo Martins',
        jobTitle: 'Engineer',
        employer: 'Beta Co',
        birthday: { year: 1985, month: 6, day: 12 },
        contact: { phone: '07700 900456', email: 'theo@example.com' },
      },
    ])
    const generic = 'name,email,phone\nJune Webb,june@example.com,\n,,+1 555 0100\n'
    expect(parseCsv(generic)).toEqual([
      { displayName: 'June Webb', contact: { email: 'june@example.com' } },
      { displayName: '+1 555 0100', contact: { phone: '+1 555 0100' } },
    ])
  })
})

describe('parseContacts + matchContacts', () => {
  it('sniffs the format from content, then the file name', () => {
    expect(parseContacts(APPLE_VCF, 'x.txt').format).toBe('vcard')
    expect(parseContacts('name,email\nA,a@b.c\n', 'contacts.csv').format).toBe('csv')
    expect(parseContacts('hello', 'notes.md').format).toBe('unknown')
  })

  it('marks people already in the vault by name, e-mail or phone and drops in-file duplicates', () => {
    const sam = person('Sam Okafor')
    const priya = person('P. Raman', { contact: { email: 'priya@example.org' } })
    const theo = person('Theo', { contact: { phone: '+44 (0)7700 900456' } })
    const out = matchContacts(
      [
        { displayName: 'sam okafor' },
        { displayName: 'Priya Raman', contact: { email: 'Priya@Example.org' } },
        { displayName: 'T. Martins', contact: { phone: '07700 900456' } },
        { displayName: 'Rosa Delgado', contact: { email: 'rosa@example.com' } },
        { displayName: 'Rosa Delgado', contact: { email: 'rosa@example.com', phone: '555 0100' } },
        { displayName: 'Rosa Delgado' },
        { displayName: 'Rui Delgado', contact: { email: 'rosa@example.com' } }, // shared household address
        { displayName: 'Zoe Orn' },
      ],
      [sam, priya, theo, person('Zoë Ørn')],
    )
    expect(out.map((c) => [c.displayName, c.existing?.displayName])).toEqual([
      ['sam okafor', 'Sam Okafor'],
      ['Priya Raman', 'P. Raman'],
      ['T. Martins', 'Theo'],
      ['Rosa Delgado', undefined],
      ['Rui Delgado', undefined],
      ['Zoe Orn', 'Zoë Ørn'],
    ])
  })

  it('flags a namesake with a different e-mail or phone as a possible match, not a lock', () => {
    const sam = person('Sam Okafor', { contact: { email: 'sam@example.com', phone: '+1 212 555 0100 x123' } })
    const out = matchContacts(
      [
        { displayName: 'Sam Okafor', contact: { email: 'other@example.com' } },
        { displayName: 'Sam Okafor', contact: { phone: '+1 (212) 555-0100' } },
        { displayName: 'S. Okafor', contact: { phone: '+44 7700 900456' } },
      ],
      [sam],
    )
    expect(out.map((c) => [c.existing?.id, c.conflict])).toEqual([
      [sam.id, true],
      [sam.id, undefined],
      [undefined, undefined],
    ])
  })
})
