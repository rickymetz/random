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

/**
 * Rank people for a typed query the way the @-mention picker does: whole
 * name or nickname prefix first, then a word prefix, then a substring;
 * an empty query lists everyone alphabetically. Returns at most `max`.
 */
export function rankPeople<P extends { displayName: string; nicknames: string[] }>(
  people: readonly P[],
  query: string,
  max: number,
): P[] {
  const q = query.trim().toLowerCase()
  const rank = (p: P): number => {
    const names = [p.displayName, ...p.nicknames].map((n) => n.toLowerCase())
    if (q === '') return 3
    if (names.some((n) => n.startsWith(q))) return 0
    if (names.some((n) => n.split(/\s+/).some((w) => w.startsWith(q)))) return 1
    if (names.some((n) => n.includes(q))) return 2
    return -1
  }
  return people
    .map((p) => ({ p, r: rank(p) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || a.p.displayName.localeCompare(b.p.displayName))
    .slice(0, max)
    .map(({ p }) => p)
}
