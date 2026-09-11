/**
 * Name helpers for the People list (§4.4): which letter a name files
 * under and a short label for the Recent row.
 */

/** Rail order: `#` first because the collator sorts digits and symbols
 * before letters, so those names sit at the top of the list. */
export const RAIL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

/**
 * Letter a name files under: its first character with any accent
 * stripped (the list is sorted by a base-sensitivity collator, so
 * "Émile" sorts among the Es and must file under E too); anything that
 * isn't A–Z after folding — digits, symbols, other scripts — files
 * under `#`.
 */
export function letterOf(name: string): string {
  const first = Array.from(name.trim().normalize('NFD').replace(/\p{M}+/gu, ''))[0] ?? ''
  const c = first.toLocaleUpperCase()
  return c.length === 1 && c >= 'A' && c <= 'Z' ? c : '#'
}

/** "Ada K." — a first name alone is ambiguous in a row of six. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  const initial = Array.from(parts[parts.length - 1])[0]?.toLocaleUpperCase() ?? ''
  return `${parts[0]} ${initial}.`
}

/** Rows the paged list must show to include index `i` (pages of `page`). */
export function rowsToReveal(index: number, page: number): number {
  return Math.ceil((index + 1) / page) * page
}
