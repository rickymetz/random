/**
 * Contacts import (§4.1 at scale): read a vCard (.vcf, as Contacts on
 * iOS/Android/macOS export it) or a CSV (Google Contacts, Outlook, or
 * any sheet with name/email/phone columns) into person drafts. Runs
 * entirely on the device; the person picks which contacts to keep.
 */
import type { PartialDate, Person } from './models'

export interface ContactDraft {
  displayName: string
  nicknames?: string[]
  jobTitle?: string
  employer?: string
  location?: string
  birthday?: PartialDate
  contact?: { phone?: string; email?: string }
  /** The contact app's free-text note, kept as this person's first note. */
  note?: string
}

export interface ImportedContact extends ContactDraft {
  /** Stable within one parse, for checkboxes. */
  key: string
  /** Someone already in the vault with this name, email or phone. */
  existing?: Person
}

// ---------- vCard ----------

function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = []
  const src = s.replace(/=\r?\n/g, '')
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(src.charCodeAt(i) & 0xff)
    }
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
  } catch {
    return src
  }
}

function unescapeValue(v: string): string {
  return v.replace(/\\([\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Split on unescaped separators (`;` between N/ADR components, `,` in lists). */
function splitUnescaped(v: string, sep: ';' | ','): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < v.length; i++) {
    const c = v[i]
    if (c === '\\' && i + 1 < v.length) {
      cur += c + v[i + 1]
      i++
    } else if (c === sep) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

interface Prop {
  name: string
  params: Map<string, string[]>
  value: string
}

function parseProp(line: string): Prop | null {
  // NAME;PARAM=a,b;PARAM2=c:value — the first ':' outside quotes ends the params.
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const head = line.slice(0, colon)
  let value = line.slice(colon + 1)
  const parts = head.split(';')
  let name = parts[0].toUpperCase()
  if (name.includes('.')) name = name.slice(name.indexOf('.') + 1) // item1.EMAIL
  const params = new Map<string, string[]>()
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    const key = (eq < 0 ? 'TYPE' : p.slice(0, eq)).toUpperCase()
    const vals = (eq < 0 ? p : p.slice(eq + 1)).replace(/"/g, '').toUpperCase().split(',')
    params.set(key, [...(params.get(key) ?? []), ...vals])
  }
  if (params.get('ENCODING')?.includes('QUOTED-PRINTABLE')) value = decodeQuotedPrintable(value)
  return { name, params, value }
}

/** vCard BDAY: 1985-06-12, 19850612, --0612, --06-12; Apple's 1604 means "no year". */
export function parseVCardDate(raw: string, omitYear = false): PartialDate | undefined {
  const s = raw.trim()
  let m = s.match(/^--(\d{2})-?(\d{2})$/)
  if (m) return { month: Number(m[1]), day: Number(m[2]) }
  m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/)
  if (!m) return undefined
  const year = Number(m[1])
  const d: PartialDate = { month: Number(m[2]), day: Number(m[3]) }
  if (!omitYear && year !== 1604 && year > 1800) d.year = year
  if (!d.month || d.month > 12 || !d.day || d.day > 31) return undefined
  const daysIn = new Date(Date.UTC(d.year ?? 2000, d.month, 0)).getUTCDate() // leap-safe; 2000 is a leap year
  if (d.day > daysIn) return undefined
  return d
}

const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined
/** Notes keep their line breaks. */
const cleanText = (s: string | undefined) =>
  s
    ?.split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || undefined

function pickPreferred(props: Prop[]): Prop | undefined {
  const pref = props.find((p) => p.params.get('TYPE')?.includes('PREF') || p.params.has('PREF'))
  return pref ?? props[0]
}

export function parseVCard(text: string): ContactDraft[] {
  // Unfold continuation lines, then walk cards.
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)
  const cards: Prop[][] = []
  let cur: Prop[] | null = null
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) cur = []
    else if (/^END:VCARD/i.test(line)) {
      if (cur) cards.push(cur)
      cur = null
    } else if (cur) {
      const p = parseProp(line)
      if (p) cur.push(p)
    }
  }
  const out: ContactDraft[] = []
  for (const props of cards) {
    const get = (name: string) => props.filter((p) => p.name === name)
    const fn = clean(unescapeValue(get('FN')[0]?.value ?? ''))
    const n = get('N')[0] ? splitUnescaped(get('N')[0].value, ';').map((s) => clean(unescapeValue(s)) ?? '') : []
    const fromN = clean([n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' '))
    const tel = pickPreferred(
      // Mobile first: it is the number people actually reach each other on.
      [...get('TEL')].sort((a, b) => Number(isMobile(b)) - Number(isMobile(a))),
    )
    const email = pickPreferred(get('EMAIL'))
    const org = get('ORG')[0] ? clean(unescapeValue(splitUnescaped(get('ORG')[0].value, ';')[0])) : undefined
    const title = clean(unescapeValue(get('TITLE')[0]?.value ?? ''))
    const nick = get('NICKNAME')[0]
      ? splitUnescaped(get('NICKNAME')[0].value, ',').map((s) => clean(unescapeValue(s)) ?? '').filter(Boolean)
      : []
    const bdayProp = get('BDAY')[0]
    const birthday = bdayProp
      ? parseVCardDate(bdayProp.value, bdayProp.params.has('X-APPLE-OMIT-YEAR'))
      : undefined
    const adr = pickPreferred(get('ADR'))
    const adrParts = adr ? splitUnescaped(adr.value, ';').map((s) => clean(unescapeValue(s))) : []
    const location = clean([adrParts[3], adrParts[6] ?? adrParts[4]].filter(Boolean).join(', '))
    const note = cleanText(unescapeValue(get('NOTE')[0]?.value ?? ''))
    const phone = clean(tel?.value)
    const mail = clean(email?.value)?.toLowerCase()
    const displayName = fn ?? fromN ?? org ?? mail?.split('@')[0] ?? phone
    if (!displayName) continue
    const draft: ContactDraft = { displayName }
    if (nick.length) draft.nicknames = nick
    if (title) draft.jobTitle = title
    if (org && org !== displayName) draft.employer = org
    if (location) draft.location = location
    if (birthday) draft.birthday = birthday
    if (phone || mail) draft.contact = { ...(phone ? { phone } : {}), ...(mail ? { email: mail } : {}) }
    if (note) draft.note = note
    out.push(draft)
  }
  return out
}

function isMobile(p: Prop): boolean {
  const t = p.params.get('TYPE') ?? []
  return t.includes('CELL') || t.includes('MOBILE') || t.includes('IPHONE')
}

// ---------- CSV ----------

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, embedded newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

const first = (row: string[], idx: number[]): string | undefined => {
  for (const i of idx) {
    const v = clean(row[i]?.split(' ::: ')[0])
    if (v) return v
  }
  return undefined
}

export function parseCsv(text: string): ContactDraft[] {
  const rows = parseCsvRows(text)
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const find = (...res: RegExp[]) =>
    res.flatMap((re) => headers.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0))
  const col = {
    name: find(/^(name|full name|display name|contact name)$/),
    given: find(/^(given name|first name|first)$/),
    middle: find(/^(additional name|middle name)$/),
    family: find(/^(family name|last name|surname|last)$/),
    email: find(/^e-?mail 1 - value$/, /^e-?mail( address)?( 1)?$/, /e-?mail.*value/, /e-?mail/),
    phone: find(/^phone 1 - value$/, /^(mobile|mobile phone|cell|cell phone|mobile number)$/, /phone.*value/, /phone|tel/),
    employer: find(/^organization 1 - name$/, /^(company|organi[sz]ation|employer)$/, /organi[sz]ation.*name/),
    title: find(/^organization 1 - title$/, /^(job title|title|position|role)$/, /organi[sz]ation.*title/),
    birthday: find(/^birthday$/, /birthday|date of birth|dob/),
    nickname: find(/^nickname$/, /nick/),
    note: find(/^notes?$/),
    city: find(/^address 1 - city$/, /^(city|home city|locality)$/, /address.*city/),
    country: find(/^address 1 - country$/, /^(country|home country)$/, /address.*country/),
  }
  const out: ContactDraft[] = []
  for (const row of rows.slice(1)) {
    const built = clean([first(row, col.given), first(row, col.middle), first(row, col.family)].filter(Boolean).join(' '))
    const email = first(row, col.email)?.toLowerCase()
    const phone = first(row, col.phone)
    const employer = first(row, col.employer)
    const displayName = first(row, col.name) ?? built ?? employer ?? email?.split('@')[0] ?? phone
    if (!displayName) continue
    const draft: ContactDraft = { displayName }
    const nick = first(row, col.nickname)
    if (nick) draft.nicknames = [nick]
    const title = first(row, col.title)
    if (title) draft.jobTitle = title
    if (employer && employer !== displayName) draft.employer = employer
    const loc = clean([first(row, col.city), first(row, col.country)].filter(Boolean).join(', '))
    if (loc) draft.location = loc
    const bday = first(row, col.birthday)
    const parsed = bday ? parseCsvDate(bday) : undefined
    if (parsed) draft.birthday = parsed
    if (phone || email) draft.contact = { ...(phone ? { phone } : {}), ...(email ? { email } : {}) }
    const note = cleanText(col.note.map((i) => row[i]).find((v) => v?.trim()))
    if (note) draft.note = note
    out.push(draft)
  }
  return out
}

function parseCsvDate(s: string): PartialDate | undefined {
  const v = parseVCardDate(s)
  if (v) return v
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) // US m/d/yyyy (Outlook)
  if (m) return { year: Number(m[3]), month: Number(m[1]), day: Number(m[2]) }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  m = s.match(/^--(\d{1,2})-(\d{1,2})$/)
  if (m) return { month: Number(m[1]), day: Number(m[2]) }
  return undefined
}

// ---------- entry point + matching ----------

export type ContactFormat = 'vcard' | 'csv' | 'unknown'

export function sniffFormat(text: string, fileName = ''): ContactFormat {
  if (/BEGIN:VCARD/i.test(text.slice(0, 2000))) return 'vcard'
  if (/\.vcf$|\.vcard$/i.test(fileName)) return 'vcard'
  if (/\.csv$|\.txt$/i.test(fileName)) return 'csv'
  const head = text.slice(0, 2000)
  if (/^[^\n]*,[^\n]*\n/.test(head)) return 'csv'
  return 'unknown'
}

export function parseContacts(text: string, fileName = ''): { format: ContactFormat; contacts: ContactDraft[] } {
  const format = sniffFormat(text, fileName)
  if (format === 'vcard') return { format, contacts: parseVCard(text) }
  if (format === 'csv') return { format, contacts: parseCsv(text) }
  return { format, contacts: [] }
}

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '')

/**
 * Attach existing people (by name or nickname, then e-mail, then phone
 * digits) and drop duplicates within the import itself.
 */
export function matchContacts(drafts: ContactDraft[], people: Person[]): ImportedContact[] {
  const byName = new Map<string, Person>()
  const byEmail = new Map<string, Person>()
  const byPhone = new Map<string, Person>()
  for (const p of people) {
    for (const n of [p.displayName, ...p.nicknames]) {
      const k = n.trim().toLowerCase()
      if (k && !byName.has(k)) byName.set(k, p)
    }
    const e = p.contact?.email?.trim().toLowerCase()
    if (e && !byEmail.has(e)) byEmail.set(e, p)
    const d = digits(p.contact?.phone)
    if (d.length >= 7 && !byPhone.has(d.slice(-9))) byPhone.set(d.slice(-9), p)
  }
  const seen = new Set<string>()
  const out: ImportedContact[] = []
  drafts.forEach((d, i) => {
    const nameKey = d.displayName.toLowerCase()
    const email = d.contact?.email?.toLowerCase()
    const phone = digits(d.contact?.phone)
    const dupKey = email || (phone.length >= 7 ? phone.slice(-9) : '') || nameKey
    if (seen.has(dupKey) || (dupKey !== nameKey && seen.has(nameKey))) return
    seen.add(dupKey)
    seen.add(nameKey)
    const existing =
      byName.get(nameKey) ??
      (email ? byEmail.get(email) : undefined) ??
      (phone.length >= 7 ? byPhone.get(phone.slice(-9)) : undefined)
    out.push({ ...d, key: `${i}`, existing })
  })
  return out
}
