/**
 * The Edit form's kept draft (see usePersistedDraft): only what was
 * changed, so fields untouched in the form keep whatever the person has
 * now when it comes back — a draft never rolls back an edit made since.
 */
import type { FieldType } from './models'

type FormValues = Record<string, string | string[]>
type CustomDraft = Record<string, unknown>

export interface DetailsState {
  form: FormValues
  custom: CustomDraft
  /** Half-typed chip text, by field. */
  chips: Record<string, string>
  isSelf: boolean
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** '' when nothing differs from `base` — nothing to keep. */
export function encodeDetailsDraft(base: Omit<DetailsState, 'chips'>, now: DetailsState): string {
  const form: FormValues = {}
  for (const [k, v] of Object.entries(now.form)) if (!same(v, base.form[k])) form[k] = v
  const custom: CustomDraft = {}
  for (const [k, v] of Object.entries(now.custom)) if (!same(v, base.custom[k])) custom[k] = v
  const chips: Record<string, string> = {}
  for (const [k, v] of Object.entries(now.chips)) if (v.trim()) chips[k] = v
  const isSelf = now.isSelf !== base.isSelf ? now.isSelf : undefined
  if (!Object.keys(form).length && !Object.keys(custom).length && !Object.keys(chips).length && isSelf === undefined)
    return ''
  return JSON.stringify({ form, custom, chips, ...(isSelf !== undefined ? { isSelf } : {}) })
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

function fitsField(type: FieldType, v: unknown): boolean {
  switch (type) {
    case 'chips':
      return isStrings(v)
    case 'boolean':
      return typeof v === 'boolean'
    case 'number':
      return v === '' || (typeof v === 'number' && Number.isFinite(v))
    default:
      return typeof v === 'string'
  }
}

/**
 * `base` with the kept changes laid over it. Anything that no longer
 * fits — a field since removed, a value of the wrong shape — is dropped,
 * never trusted. Undefined when there is nothing usable to restore.
 */
export function applyDetailsDraft(
  text: string | undefined,
  base: Omit<DetailsState, 'chips'>,
  customTypes: Record<string, FieldType>,
): DetailsState | undefined {
  if (!text) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const p = parsed as { form?: unknown; custom?: unknown; chips?: unknown; isSelf?: unknown }
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  const form = { ...base.form }
  let changed = false
  for (const [k, v] of Object.entries(obj(p.form))) {
    if (!(k in base.form)) continue
    const fits = Array.isArray(base.form[k]) ? isStrings(v) : typeof v === 'string'
    if (fits) {
      form[k] = v as string | string[]
      changed = true
    }
  }
  const custom = { ...base.custom }
  for (const [k, v] of Object.entries(obj(p.custom))) {
    const type = customTypes[k]
    if (type && fitsField(type, v)) {
      custom[k] = v
      changed = true
    }
  }
  const chips: Record<string, string> = {}
  const chipFields = new Set([
    ...Object.keys(base.form).filter((k) => Array.isArray(base.form[k])),
    ...Object.keys(customTypes).filter((k) => customTypes[k] === 'chips'),
  ])
  for (const [k, v] of Object.entries(obj(p.chips))) {
    if (chipFields.has(k) && typeof v === 'string' && v.trim()) {
      chips[k] = v
      changed = true
    }
  }
  let isSelf = base.isSelf
  if (typeof p.isSelf === 'boolean' && p.isSelf !== base.isSelf) {
    isSelf = p.isSelf
    changed = true
  }
  return changed ? { form, custom, chips, isSelf } : undefined
}
