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
  /** `existing` matched by name only while the e-mail or phone disagree: probably a namesake. */
  conflict?: boolean
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
  return validDate(d)
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

/** vCard 3 marks the preferred entry with TYPE=PREF; vCard 4 ranks with PREF=1..100. */
function prefRank(p: Prop): number {
  if (p.params.get('TYPE')?.includes('PREF')) return 1
  const n = Number(p.params.get('PREF')?.[0])
  return Number.isFinite(n) && n > 0 ? n : 101
}
function pickPreferred(props: Prop[]): Prop | undefined {
  return [...props].sort((a, b) => prefRank(a) - prefRank(b))[0]
}

/** Phones as people type them, minus URI/spreadsheet noise: "tel:+1-555-0100;ext=42" → "+1-555-0100 ext. 42". */
export function cleanPhone(raw: string | undefined): string | undefined {
  const v = clean(raw)?.replace(/^tel:/i, '').replace(/^'/, '').replace(/;ext=(\d+)$/i, ' ext. $1')
  return clean(v)
}

export function parseVCard(text: string): ContactDraft[] {
  // vCard 2.1 quoted-printable soft breaks ("=" at line end, no leading
  // space on the next line — Android exports) are joined first, on QP
  // lines only so base64 "=" padding on PHOTO lines stays put; then
  // RFC 2425 folds (leading space/tab) are unfolded.
  const joined = text.replace(
    /^[^\r\n]*;ENCODING=QUOTED-PRINTABLE[^\r\n]*?(?:=\r?\n[^\r\n]*?)*(?=\r?\n|$)/gim,
    (m) => m.replace(/=\r?\n/g, ''),
  )
  const unfolded = joined.replace(/\r?\n[ \t]/g, '')
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
    // Mobile first (it is the number people actually reach each other on), then PREF.
    const tels = [...get('TEL')].sort((a, b) => Number(isMobile(b)) - Number(isMobile(a)) || prefRank(a) - prefRank(b))
    const tel = tels[0]
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
    const phone = cleanPhone(tel?.value)
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
export function parseCsvRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\ufeff/, '')
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
    else if (c === delimiter) {
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
  // Excel in many locales writes ";"-separated files.
  const headLine = text.replace(/^\ufeff/, '').split(/\r?\n|\r/)[0] ?? ''
  const delimiter = !headLine.includes(',') && headLine.includes(';') ? ';' : ','
  const rows = parseCsvRows(text, delimiter)
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const find = (...res: RegExp[]) =>
    res.flatMap((re) => headers.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0))
  const col = {
    name: find(/^(name|full name|display name|contact name)$/),
    given: find(/^(given name|first name|first)$/),
    middle: find(/^(additional name|middle name)$/),
    family: find(/^(family name|last name|surname|last)$/),
    email: find(
      /^e-?mail 1 - value$/,
      /^e-?mail( address)?( 1)?$/,
      /^(?!.*(label|type|display name))e-?mail.*value/,
      /^(?!.*(label|type|display name))e-?mail/,
    ),
    phone: find(
      /^phone 1 - value$/,
      /^(mobile|mobile phone|cell|cell phone|mobile number)$/,
      /^(?!.*(label|type))phone.*value/,
      /^(?!.*(label|type))(phone|tel)/,
    ),
    employer: find(/^organization 1 - name$/, /^(company|organi[sz]ation|organization name|employer)$/, /organi[sz]ation.*name/),
    title: find(
      /^organization( 1)?( -)? ?title$/,
      /^job title$/,
      /^(position|role)$/,
      // Outlook's bare "Title" is the honorific (Mr., Dr.) — only a job title when nothing better exists.
      ...(headers.some((h) => /job title|organization.*title/.test(h)) ? [] : [/^title$/]),
    ),
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
    const phone = cleanPhone(first(row, col.phone))
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

function validDate(d: PartialDate): PartialDate | undefined {
  if (!d.month || d.month > 12 || !d.day || d.day > 31) return undefined
  const daysIn = new Date(Date.UTC(d.year ?? 2000, d.month, 0)).getUTCDate()
  return d.day > daysIn ? undefined : d
}

function parseCsvDate(s: string): PartialDate | undefined {
  const v = parseVCardDate(s)
  if (v) return v
  let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/) // m/d/yyyy (Outlook US) or d/m/yyyy elsewhere
  if (m) {
    let month = Number(m[1])
    let day = Number(m[2])
    if (month > 12 && day <= 12) [month, day] = [day, month]
    return validDate({ year: Number(m[3]), month, day })
  }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m) return validDate({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })
  m = s.match(/^--(\d{1,2})-(\d{1,2})$/)
  if (m) return validDate({ month: Number(m[1]), day: Number(m[2]) })
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

/** Digits of a phone without its extension; the key is the last 10 (or all, when shorter). */
function phoneKey(s: string | undefined): string {
  const d = (s ?? '').replace(/\s*(x|ext\.?|#|;ext=)\s*\d+$/i, '').replace(/\D/g, '')
  if (d.length < 7) return ''
  return d.length >= 10 ? d.slice(-10) : d
}

/** Case- and accent-insensitive name key ("Zoë Ørn" ≈ "zoe orn"). */
export function nameKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[Øø]/g, 'o')
    .replace(/[Łł]/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Attach existing people (by name or nickname, then e-mail, then phone)
 * and drop duplicates within the import itself. A name match whose
 * e-mail or phone contradicts the person here is only a *possible*
 * match (`conflict`): shown, but still importable.
 */
export function matchContacts(drafts: ContactDraft[], people: Person[]): ImportedContact[] {
  const byName = new Map<string, Person>()
  const byEmail = new Map<string, Person>()
  const byPhone = new Map<string, Person>()
  for (const p of people) {
    for (const n of [p.displayName, ...p.nicknames]) {
      const k = nameKey(n)
      if (k && !byName.has(k)) byName.set(k, p)
    }
    const e = p.contact?.email?.trim().toLowerCase()
    if (e && !byEmail.has(e)) byEmail.set(e, p)
    const d = phoneKey(p.contact?.phone)
    if (d && !byPhone.has(d)) byPhone.set(d, p)
  }
  const seenNames = new Set<string>()
  const seenContact = new Map<string, string>() // e-mail/phone key → name key it belonged to
  const out: ImportedContact[] = []
  drafts.forEach((d, i) => {
    const name = nameKey(d.displayName)
    const email = d.contact?.email?.trim().toLowerCase() || ''
    const phone = phoneKey(d.contact?.phone)
    const keys = [email, phone].filter(Boolean)
    // Duplicate: same name and (no way to tell them apart, or same e-mail/phone);
    // or same e-mail/phone already seen under this very name. Two people who
    // share a household address stay two people.
    const sameNameSeen = seenNames.has(name)
    const sameContactSeen = keys.some((k) => seenContact.has(k))
    const contactUnderThisName = keys.some((k) => seenContact.get(k) === name)
    if ((sameNameSeen && (keys.length === 0 || sameContactSeen)) || contactUnderThisName) return
    seenNames.add(name)
    for (const k of keys) if (!seenContact.has(k)) seenContact.set(k, name)

    const byContact = (email ? byEmail.get(email) : undefined) ?? (phone ? byPhone.get(phone) : undefined)
    const named = byName.get(name)
    let existing = byContact ?? named
    let conflict = false
    if (!byContact && named) {
      const theirEmail = named.contact?.email?.trim().toLowerCase() || ''
      const theirPhone = phoneKey(named.contact?.phone)
      conflict = Boolean((email && theirEmail && email !== theirEmail) || (phone && theirPhone && phone !== theirPhone))
    }
    if (!existing) existing = undefined
    out.push({ ...d, key: `${i}`, existing, ...(conflict ? { conflict: true } : {}) })
  })
  return out
}
